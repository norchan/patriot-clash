import { describe, it, expect } from 'vitest'
import { sameStory, titleTokens, tooSimilar, normalizeText } from '@/lib/content-unique'

// Pins the shared uniqueness detectors (boards polish Phase C/D): the news
// crons' no-doubles contract and the comment near-dupe gate both ride on
// these exact thresholds — a drive-by tweak here changes bot behavior
// everywhere at once.

describe('sameStory', () => {
  it('flags a paraphrased headline as the same story', () => {
    const subject = titleTokens('Minnesota Vikings')
    expect(sameStory(
      'Vikings release TE Josh Oliver',
      'Vikings expected to release injury-riddled TE Josh Oliver - ESPN',
      subject,
    )).toBe(true)
  })

  it('keeps genuinely different stories apart', () => {
    const subject = titleTokens('Minnesota Vikings')
    expect(sameStory(
      'Vikings release TE Josh Oliver',
      'Vikings announce new stadium concession partners for the season',
      subject,
    )).toBe(false)
  })

  it('strips shared subject words so they cannot fake an overlap', () => {
    const subject = titleTokens('California')
    expect(sameStory(
      'California wildfire forces evacuations in the north',
      'California lawmakers pass new housing bill',
      subject,
    )).toBe(false)
  })
})

describe('tooSimilar', () => {
  it('catches an exact repeat regardless of punctuation/case', () => {
    expect(tooSimilar('Love this for our town!', 'love this for our town')).toBe(true)
  })

  it('catches a light paraphrase', () => {
    expect(tooSimilar(
      'Finally some good news for the downtown farmers market this year',
      'finally some good news for the farmers market downtown',
    )).toBe(true)
  })

  it('lets genuinely different comments through', () => {
    expect(tooSimilar(
      'The council should have voted this down months ago',
      'Anyone know what time the parade starts on Saturday?',
    )).toBe(false)
  })

  it('short texts only match near-exactly', () => {
    expect(tooSimilar('so true', 'so wrong')).toBe(false)
    expect(tooSimilar('so true', 'So true!')).toBe(true)
  })
})

describe('normalizeText', () => {
  it('canonicalizes case, punctuation and whitespace', () => {
    expect(normalizeText('  Hello,   WORLD!! ')).toBe('hello world')
  })
})
