'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, DollarSign, FileText, TrendingUp } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { CREATOR_EARNINGS } from '@/config/creator-earnings'

const RATE = CREATOR_EARNINGS.USD_PER_1000_IMPRESSIONS.toFixed(2)
const MIN = CREATOR_EARNINGS.MIN_WITHDRAW_USD.toFixed(2)
const HOLD = CREATOR_EARNINGS.HOLD_DAYS

export default function MakeMoneyPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const [enrolled, setEnrolled] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  async function enrollInProgram() {
    if (!agreedToTerms || !profile) return
    try {
      const res = await fetch('/api/creator-program/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreed_to_terms: true }),
      })
      if (res.ok) {
        setEnrolled(true)
      }
    } catch (err) {
      console.error('Error enrolling:', err)
    }
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="px-4 pt-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-6 hover:text-white">
          <ArrowLeft size={16} /><span className="text-sm">Back</span>
        </button>

        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <DollarSign size={48} className="text-green-400" />
            </div>
            <h1 className="text-white font-bold text-3xl mb-2">Make Money with PoliticsGo</h1>
            <p className="text-gray-400">Get paid for your content. Earn ${RATE} per 1,000 impressions.</p>
          </div>

          {/* How it works */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h2 className="text-white font-bold text-lg mb-4">How It Works</h2>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">1</div>
                <div>
                  <p className="text-white font-bold">Create Original Content</p>
                  <p className="text-gray-400 text-sm">Post pictures, messages, and content to your profile and town halls. Only original content you upload counts.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">2</div>
                <div>
                  <p className="text-white font-bold">Get Impressions</p>
                  <p className="text-gray-400 text-sm">When people view your posts and messages, you earn impressions. Track them in real-time on each post.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">3</div>
                <div>
                  <p className="text-white font-bold">Earn Money</p>
                  <p className="text-gray-400 text-sm">Earn ${RATE} per 1,000 impressions. Withdraw after {HOLD} days when you reach ${MIN} minimum.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">4</div>
                <div>
                  <p className="text-white font-bold">Get Paid</p>
                  <p className="text-gray-400 text-sm">Withdraw to your bank account. Stripe handles the payment securely.</p>
                </div>
              </div>
            </div>
          </div>

          {/* What counts */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
              <TrendingUp size={20} /> What Counts
            </h2>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300">✅ Posts on your profile</p>
              <p className="text-gray-300">✅ Pictures and videos you upload</p>
              <p className="text-gray-300">✅ Messages you send</p>
              <p className="text-gray-300">✅ Posts on town halls</p>
              <p className="text-red-400 mt-4">❌ Links to other websites (not eligible)</p>
              <p className="text-red-400">❌ Reposted content from elsewhere</p>
              <p className="text-red-400">❌ Content that violates our terms</p>
            </div>
          </div>

          {/* Enrollment */}
          {!enrolled ? (
            <div className="bg-gradient-to-r from-purple-900/50 to-green-900/50 border border-purple-600 rounded-2xl p-6 mb-6">
              <h2 className="text-white font-bold text-lg mb-4">Join the Creator Program</h2>
              <div className="bg-gray-900/50 rounded-xl p-4 mb-4">
                <p className="text-gray-300 text-sm mb-3">To get started, you'll need to:</p>
                <ul className="text-gray-400 text-sm space-y-2">
                  <li>✓ Be at least 18 years old</li>
                  <li>✓ Provide a valid bank account for withdrawals</li>
                  <li>✓ Verify your identity (ID and SSN)</li>
                  <li>✓ Agree to our creator terms (original content only)</li>
                </ul>
              </div>

              <label className="flex items-start gap-3 mb-4">
                <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-600 cursor-pointer" />
                <span className="text-gray-300 text-sm">
                  I agree to create only original content and follow the creator program terms
                </span>
              </label>

              <button onClick={enrollInProgram} disabled={!agreedToTerms}
                className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-green-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-40 transition">
                Start Earning Now
              </button>

              <p className="text-gray-500 text-xs mt-3 text-center">
                Your bank and identity info is securely handled by Stripe. We never store it.
              </p>
            </div>
          ) : (
            <div className="bg-green-900/30 border border-green-600 rounded-2xl p-6 mb-6">
              <p className="text-green-400 font-bold text-center">✓ You're enrolled! Start creating to earn.</p>
            </div>
          )}

          {/* FAQ */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
              <FileText size={20} /> FAQ
            </h2>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-white font-bold mb-1">When can I withdraw?</p>
                <p className="text-gray-400">After {HOLD} days from the impression date, once you have at least ${MIN} earned.</p>
              </div>
              <div>
                <p className="text-white font-bold mb-1">What's the fee to withdraw?</p>
                <p className="text-gray-400">Standard bank transfer fee (~2.2% + $0.30). We pay this, not you.</p>
              </div>
              <div>
                <p className="text-white font-bold mb-1">How do I track my earnings?</p>
                <p className="text-gray-400">Tap the $ number on any post to see its impressions and potential earnings.</p>
              </div>
              <div>
                <p className="text-white font-bold mb-1">Is my content safe?</p>
                <p className="text-gray-400">Yes. You own your content. We just display it and pay you for impressions.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
