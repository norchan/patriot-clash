// GOOGLE PLAY BILLING — server-side purchase verification.
//
// Google Play policy requires digital goods consumed inside the Android app to
// be sold through Play Billing, not Stripe. The TWA exposes the Digital Goods
// API to the web app; the client gets a purchase token from Play, and THIS
// module is what decides whether that token is real.
//
// NEVER grant FP on the client's say-so. A purchase token from the browser is
// an untrusted string until Google confirms it: the client could be a modified
// app, a replayed token, or someone hitting the endpoint directly with curl.
//
// Auth is a service-account JWT exchanged for an access token. We sign it by
// hand rather than pulling in googleapis — one RS256 signature and a form POST,
// against a fat dependency in a serverless bundle.
import crypto from 'crypto'

const PACKAGE_NAME = 'app.politicsgo.twa'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

interface ServiceAccount { client_email: string; private_key: string }

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    if (!sa.client_email || !sa.private_key) return null
    // Env vars usually carry the key with literal \n rather than real newlines
    return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, '\n') }
  } catch {
    console.error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON')
    return null
  }
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** Cached access token — they last an hour, so don't buy a new one per call. */
let cached: { token: string; expires: number } | null = null

async function accessToken(): Promise<string | null> {
  if (cached && Date.now() < cached.expires - 60_000) return cached.token
  const sa = serviceAccount()
  if (!sa) return null

  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: sa.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`

  let assertion: string
  try {
    const signer = crypto.createSign('RSA-SHA256')
    signer.update(unsigned)
    signer.end()
    assertion = `${unsigned}.${signer.sign(sa.private_key).toString('base64url')}`
  } catch (err) {
    console.error('play-billing: could not sign service-account JWT', err)
    return null
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    console.error('play-billing: token exchange failed', res.status, await res.text().catch(() => ''))
    return null
  }
  const j = await res.json()
  if (!j.access_token) return null
  cached = { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return cached.token
}

export interface PlayVerdict {
  ok: boolean
  /** why it failed — safe to log, not to show verbatim to the player */
  reason?: string
  orderId?: string
  /** already consumed by Play; treated as spent, not as a fresh grant */
  consumed?: boolean
}

/**
 * Ask Google whether this token really is a completed purchase of this product.
 * Returns ok:false for anything other than an unambiguous "yes".
 */
export async function verifyPlayPurchase(productId: string, purchaseToken: string): Promise<PlayVerdict> {
  const token = await accessToken()
  if (!token) return { ok: false, reason: 'no_service_account' }

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
    + `${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    // 404 = Google has never heard of this token for this product: forged,
    // wrong product, or a token from another app entirely.
    return { ok: false, reason: `google_${res.status}` }
  }
  const p = await res.json()

  // purchaseState: 0 purchased · 1 cancelled · 2 pending
  if (p.purchaseState !== 0) return { ok: false, reason: `state_${p.purchaseState}` }

  return { ok: true, orderId: p.orderId, consumed: p.consumptionState === 1 }
}

/** Is Play Billing wired up at all? Used to decide whether to offer it. */
export const playBillingConfigured = () => !!serviceAccount()
