// Politician tracker roster (Michael): one tracked politician per state
// (the sitting governor, except where Michael picked someone — SC = Nancy
// Mace) plus the national figures. Tracker accounts REPORT what these
// people say in public, with links — they never post AS the person.
// Adding a politician = one row; the cron auto-creates its account.
// Governors current as of mid-2026 — revisit after the Nov 2026 elections.

export interface TrackedPolitician {
  key: string        // stable id → clerk_user_id bot_tracker_<key>
  name: string       // full name, used as the quoted Google News query
  lastName: string   // must appear in the headline (guards stray matches)
  username: string   // the tracker account's handle
  party: 'democrat' | 'republican'
  state: string | null // 2-letter code → their state psub; null = national
}

export const POLITICIANS: TrackedPolitician[] = [
  // national
  { key: 'trump', name: 'Donald Trump', lastName: 'Trump', username: 'TrumpTracker', party: 'republican', state: null },
  { key: 'vance', name: 'JD Vance', lastName: 'Vance', username: 'VanceWatch', party: 'republican', state: null },
  { key: 'aoc', name: 'Alexandria Ocasio-Cortez', lastName: 'Ocasio-Cortez', username: 'AOCWatch', party: 'democrat', state: null },
  { key: 'johnson', name: 'Mike Johnson', lastName: 'Johnson', username: 'SpeakerWatch', party: 'republican', state: null },
  // one per state
  { key: 'ivey', name: 'Kay Ivey', lastName: 'Ivey', username: 'IveyWatch', party: 'republican', state: 'AL' },
  { key: 'dunleavy', name: 'Mike Dunleavy', lastName: 'Dunleavy', username: 'DunleavyWatch', party: 'republican', state: 'AK' },
  { key: 'hobbs', name: 'Katie Hobbs', lastName: 'Hobbs', username: 'HobbsWatch', party: 'democrat', state: 'AZ' },
  { key: 'sanders', name: 'Sarah Huckabee Sanders', lastName: 'Sanders', username: 'HuckabeeWatch', party: 'republican', state: 'AR' },
  { key: 'newsom', name: 'Gavin Newsom', lastName: 'Newsom', username: 'NewsomTracker', party: 'democrat', state: 'CA' },
  { key: 'polis', name: 'Jared Polis', lastName: 'Polis', username: 'PolisWatch', party: 'democrat', state: 'CO' },
  { key: 'lamont', name: 'Ned Lamont', lastName: 'Lamont', username: 'LamontWatch', party: 'democrat', state: 'CT' },
  { key: 'meyer', name: 'Matt Meyer', lastName: 'Meyer', username: 'MeyerWatch', party: 'democrat', state: 'DE' },
  { key: 'desantis', name: 'Ron DeSantis', lastName: 'DeSantis', username: 'DeSantisWatch', party: 'republican', state: 'FL' },
  { key: 'kemp', name: 'Brian Kemp', lastName: 'Kemp', username: 'KempWatch', party: 'republican', state: 'GA' },
  { key: 'green', name: 'Josh Green', lastName: 'Green', username: 'GreenWatch', party: 'democrat', state: 'HI' },
  { key: 'little', name: 'Brad Little', lastName: 'Little', username: 'LittleWatch', party: 'republican', state: 'ID' },
  { key: 'pritzker', name: 'JB Pritzker', lastName: 'Pritzker', username: 'PritzkerWatch', party: 'democrat', state: 'IL' },
  { key: 'braun', name: 'Mike Braun', lastName: 'Braun', username: 'BraunWatch', party: 'republican', state: 'IN' },
  { key: 'reynolds', name: 'Kim Reynolds', lastName: 'Reynolds', username: 'ReynoldsWatch', party: 'republican', state: 'IA' },
  { key: 'kelly', name: 'Laura Kelly', lastName: 'Kelly', username: 'KellyWatch', party: 'democrat', state: 'KS' },
  { key: 'beshear', name: 'Andy Beshear', lastName: 'Beshear', username: 'BeshearWatch', party: 'democrat', state: 'KY' },
  { key: 'landry', name: 'Jeff Landry', lastName: 'Landry', username: 'LandryWatch', party: 'republican', state: 'LA' },
  { key: 'mills', name: 'Janet Mills', lastName: 'Mills', username: 'MillsWatch', party: 'democrat', state: 'ME' },
  { key: 'moore', name: 'Wes Moore', lastName: 'Moore', username: 'MooreWatch', party: 'democrat', state: 'MD' },
  { key: 'healey', name: 'Maura Healey', lastName: 'Healey', username: 'HealeyWatch', party: 'democrat', state: 'MA' },
  { key: 'whitmer', name: 'Gretchen Whitmer', lastName: 'Whitmer', username: 'WhitmerWatch', party: 'democrat', state: 'MI' },
  { key: 'walz', name: 'Tim Walz', lastName: 'Walz', username: 'WalzWatch', party: 'democrat', state: 'MN' },
  { key: 'reeves', name: 'Tate Reeves', lastName: 'Reeves', username: 'ReevesWatch', party: 'republican', state: 'MS' },
  { key: 'kehoe', name: 'Mike Kehoe', lastName: 'Kehoe', username: 'KehoeWatch', party: 'republican', state: 'MO' },
  { key: 'gianforte', name: 'Greg Gianforte', lastName: 'Gianforte', username: 'GianforteWatch', party: 'republican', state: 'MT' },
  { key: 'pillen', name: 'Jim Pillen', lastName: 'Pillen', username: 'PillenWatch', party: 'republican', state: 'NE' },
  { key: 'lombardo', name: 'Joe Lombardo', lastName: 'Lombardo', username: 'LombardoWatch', party: 'republican', state: 'NV' },
  { key: 'ayotte', name: 'Kelly Ayotte', lastName: 'Ayotte', username: 'AyotteWatch', party: 'republican', state: 'NH' },
  { key: 'sherrill', name: 'Mikie Sherrill', lastName: 'Sherrill', username: 'SherrillWatch', party: 'democrat', state: 'NJ' },
  { key: 'lujan', name: 'Michelle Lujan Grisham', lastName: 'Lujan Grisham', username: 'LujanGrishamWatch', party: 'democrat', state: 'NM' },
  { key: 'hochul', name: 'Kathy Hochul', lastName: 'Hochul', username: 'HochulWatch', party: 'democrat', state: 'NY' },
  { key: 'stein', name: 'Josh Stein', lastName: 'Stein', username: 'SteinWatch', party: 'democrat', state: 'NC' },
  { key: 'armstrong', name: 'Kelly Armstrong', lastName: 'Armstrong', username: 'ArmstrongWatch', party: 'republican', state: 'ND' },
  { key: 'dewine', name: 'Mike DeWine', lastName: 'DeWine', username: 'DeWineWatch', party: 'republican', state: 'OH' },
  { key: 'stitt', name: 'Kevin Stitt', lastName: 'Stitt', username: 'StittWatch', party: 'republican', state: 'OK' },
  { key: 'kotek', name: 'Tina Kotek', lastName: 'Kotek', username: 'KotekWatch', party: 'democrat', state: 'OR' },
  { key: 'shapiro', name: 'Josh Shapiro', lastName: 'Shapiro', username: 'ShapiroWatch', party: 'democrat', state: 'PA' },
  { key: 'mckee', name: 'Dan McKee', lastName: 'McKee', username: 'McKeeWatch', party: 'democrat', state: 'RI' },
  { key: 'mace', name: 'Nancy Mace', lastName: 'Mace', username: 'MaceWatch', party: 'republican', state: 'SC' },
  { key: 'rhoden', name: 'Larry Rhoden', lastName: 'Rhoden', username: 'RhodenWatch', party: 'republican', state: 'SD' },
  { key: 'lee', name: 'Bill Lee', lastName: 'Lee', username: 'GovLeeWatch', party: 'republican', state: 'TN' },
  { key: 'abbott', name: 'Greg Abbott', lastName: 'Abbott', username: 'AbbottWatch', party: 'republican', state: 'TX' },
  { key: 'cox', name: 'Spencer Cox', lastName: 'Cox', username: 'CoxWatch', party: 'republican', state: 'UT' },
  { key: 'scott', name: 'Phil Scott', lastName: 'Scott', username: 'GovScottWatch', party: 'republican', state: 'VT' },
  { key: 'spanberger', name: 'Abigail Spanberger', lastName: 'Spanberger', username: 'SpanbergerWatch', party: 'democrat', state: 'VA' },
  { key: 'ferguson', name: 'Bob Ferguson', lastName: 'Ferguson', username: 'FergusonWatch', party: 'democrat', state: 'WA' },
  { key: 'morrisey', name: 'Patrick Morrisey', lastName: 'Morrisey', username: 'MorriseyWatch', party: 'republican', state: 'WV' },
  { key: 'evers', name: 'Tony Evers', lastName: 'Evers', username: 'EversWatch', party: 'democrat', state: 'WI' },
  { key: 'gordon', name: 'Mark Gordon', lastName: 'Gordon', username: 'GordonWatch', party: 'republican', state: 'WY' },
]
