'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Header avatar menu (Michael): top-right of the homepage, right of the
// PoliticsGo title. Signed-in: your profile picture in your party's red/blue
// ring → dropdown with Profile + Local Players. Signed-out: a white "PGO"
// circle in red-white-and-blue → See local players, which routes through
// sign-up and lands on the local-players screen once the account exists.

export default function HomeAvatarMenu({ signedIn, avatarUrl, party, username }: {
  signedIn: boolean
  avatarUrl: string | null
  party: string | null
  username: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ring = party === 'democrat' ? '#2563eb' : party === 'republican' ? '#dc2626' : '#6b7280'
  const go = (path: string) => { setOpen(false); router.push(path) }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Account menu"
        className="block w-9 h-9 rounded-full transition active:scale-95">
        {signedIn ? (
          avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover"
              style={{ boxShadow: `0 0 0 2px ${ring}` }} />
          ) : (
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-white"
              style={{ background: ring, boxShadow: `0 0 0 2px ${ring}` }}>
              {(username ?? 'P')[0]?.toUpperCase()}
            </span>
          )
        ) : (
          // white circle, PGO in red / white / blue (the G carries a soft
          // outline so white-on-white still reads)
          <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center font-black text-[11px] tracking-tight"
            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}>
            <span style={{ color: '#dc2626' }}>P</span>
            <span style={{ color: '#ffffff', textShadow: '0 0 2px rgba(0,0,0,0.75)' }}>G</span>
            <span style={{ color: '#2563eb' }}>O</span>
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 z-50 w-48 rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl overflow-hidden">
            {signedIn ? (
              <>
                <button onClick={() => go('/profile')}
                  className="w-full px-4 py-3 text-left text-sm font-bold text-gray-200 hover:bg-white/5">
                  👤 My profile
                </button>
                <button onClick={() => go('/active')}
                  className="w-full px-4 py-3 text-left text-sm font-bold text-gray-200 hover:bg-white/5 border-t border-gray-800">
                  📍 Local players
                </button>
              </>
            ) : (
              // sign-up first, then straight to the local players screen
              <button onClick={() => go(`/sign-up?redirect_url=${encodeURIComponent('/active')}`)}
                className="w-full px-4 py-3 text-left text-sm font-bold text-gray-200 hover:bg-white/5">
                📍 See local players
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
