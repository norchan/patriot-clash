// Content moderation via OpenAI. Two layers:
//  1. omni-moderation-latest (FREE endpoint) screens every human-uploaded
//     image and every human post/comment text.
//  2. When adult albums are enabled, images the free endpoint flags as
//     "sexual" get a second look from a small vision model that applies the
//     house policy: nudity (including erections) is allowed in album
//     photos, sexual ACTS (penetration, oral, masturbation, sex between
//     people) are not. Avatars and post images stay fully SFW.
//
// Anything suspected of involving minors is rejected and quarantined as a
// moderation_reports row (metadata only — the image is never stored) so the
// operator can file the legally required NCMEC report.
//
// Master switch: MODERATION_ENABLED=true. When off (default), no API calls
// are made and everything is allowed — zero credit spend.
// Adult albums switch: MODERATION_ADULT_ALBUMS=true (off = albums SFW too).

export type ModContext = 'avatar' | 'album' | 'post_image'

export interface ModVerdict {
  allowed: boolean
  reason?: string          // user-facing rejection message
  csamSuspected?: boolean
  details?: any            // category scores etc., for the report row
}

const OK: ModVerdict = { allowed: true }

// The app is ad-supported and rated for everyone, so moderation runs whenever
// an OpenAI key is present (on by default; set MODERATION_ENABLED=false only
// for local dev). Adult/nudity content is never allowed — it would violate
// AdSense/AdMob policy and cost ad revenue.
function enabled() {
  return !!process.env.OPENAI_API_KEY && process.env.MODERATION_ENABLED !== 'false'
}
function adultAlbums() {
  return false
}

async function callModeration(input: any): Promise<any | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
    })
    if (!res.ok) {
      console.error('moderation API error:', res.status, await res.text().catch(() => ''))
      return null
    }
    return (await res.json())?.results?.[0] ?? null
  } catch (err) {
    console.error('moderation API unreachable:', err)
    return null
  }
}

// ── Text: posts, comments ───────────────────────────────────────────────────
export async function moderateText(text: string): Promise<ModVerdict> {
  if (!enabled() || !text?.trim()) return OK
  const r = await callModeration(text.slice(0, 4000))
  if (!r) return OK // fail-open: an OpenAI outage shouldn't brick posting
  const c = r.categories ?? {}
  if (c['sexual/minors']) {
    return { allowed: false, csamSuspected: true, reason: 'This content violates our community guidelines.', details: r.category_scores }
  }
  if (c.sexual || c['hate/threatening'] || c['harassment/threatening'] || c['violence/graphic']) {
    return { allowed: false, reason: 'This content violates our community guidelines. Keep it heated, not hateful.', details: r.category_scores }
  }
  return OK
}

// ── Images: avatars, album photos, post images (base64 data URL) ───────────
export async function moderateImage(dataUrl: string, context: ModContext): Promise<ModVerdict> {
  if (!enabled() || !dataUrl) return OK
  const r = await callModeration([{ type: 'image_url', image_url: { url: dataUrl } }])
  if (!r) return OK
  const c = r.categories ?? {}
  const scores = r.category_scores ?? {}

  if (c['sexual/minors']) {
    return { allowed: false, csamSuspected: true, reason: 'This image can’t be uploaded.', details: scores }
  }
  if (c['violence/graphic']) {
    return { allowed: false, reason: 'Graphic violence isn’t allowed here.', details: scores }
  }

  if (c.sexual) {
    // Album photos may allow nudity — but never sexual acts. A cheap vision
    // model applies that distinction; everything else stays SFW.
    if (context === 'album' && adultAlbums()) {
      return await classifyAdultImage(dataUrl, scores)
    }
    return {
      allowed: false,
      reason: context === 'avatar'
        ? 'Profile pictures must be safe for work.'
        : 'Posts must be safe for work.',
      details: scores,
    }
  }
  return OK
}

// House policy check for adult-allowed album photos
async function classifyAdultImage(dataUrl: string, modScores: any): Promise<ModVerdict> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 60,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a strict content-policy classifier for an adults-allowed photo album. ' +
              'Respond ONLY with JSON: {"sex_act": boolean, "minors_possible": boolean}. ' +
              '"sex_act" is true if the image depicts any sexual ACT: penetration of any kind, oral sex, ' +
              'masturbation or manual stimulation, sexual contact between people, or ejaculation. ' +
              'Mere nudity — including visible genitals or an erection with no act being performed — is sex_act: false. ' +
              '"minors_possible" is true if any person could plausibly be under 18.',
          },
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }],
          },
        ],
      }),
    })
    if (!res.ok) {
      console.error('adult classifier error:', res.status, await res.text().catch(() => ''))
      return OK
    }
    const data = await res.json()
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}')
    if (parsed.minors_possible) {
      return { allowed: false, csamSuspected: true, reason: 'This image can’t be uploaded.', details: { modScores, classifier: parsed } }
    }
    if (parsed.sex_act) {
      return { allowed: false, reason: 'Nudity is allowed in albums — explicit sexual acts are not.', details: { modScores, classifier: parsed } }
    }
    return OK
  } catch (err) {
    console.error('adult classifier unreachable:', err)
    return OK
  }
}

// ── Quarantine record for suspected illegal material ───────────────────────
// Metadata only — the image was rejected before upload and is never stored.
// The operator must review these and file the mandatory NCMEC CyberTipline
// report (report.cybertip.org) for anything genuine.
export async function recordCsamSuspect(
  admin: any,
  args: { profileId: string; targetType: string; details?: any }
) {
  try {
    await admin.from('moderation_reports').insert({
      kind: 'csam_suspect',
      target_type: args.targetType,
      reported_profile_id: args.profileId,
      reason: 'Automated screen flagged possible minor-involved sexual content',
      details: args.details ?? null,
    })
  } catch (err) {
    console.error('failed to record csam suspect:', err)
  }
}
