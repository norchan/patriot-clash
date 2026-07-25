import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const admin = createClient(supabaseUrl, supabaseKey)

async function seedImpressions() {
  try {
    // Seed profile_posts (already done, but including for completeness)
    console.log('Seeding profile_posts impressions...')
    const { data: profilePosts } = await admin
      .from('profile_posts')
      .select('id, created_at')
      .order('created_at', { ascending: false })

    if (profilePosts?.length) {
      const profileUpdates = profilePosts.map((post, idx) => {
        let impressions
        if (idx < 100) {
          impressions = Math.floor(5000 + Math.random() * 7000)
        } else if (idx < 500) {
          impressions = Math.floor(1000 + Math.random() * 4000)
        } else {
          impressions = Math.floor(Math.random() * 1000)
        }
        return { id: post.id, impressions }
      })

      for (const update of profileUpdates) {
        await admin
          .from('profile_posts')
          .update({ impressions: update.impressions })
          .eq('id', update.id)
          .throwOnError()
      }
      console.log(`✓ Seeded ${profilePosts.length} profile posts`)
    }

    // Seed hall_posts
    console.log('Seeding hall_posts impressions...')
    const { data: hallPosts } = await admin
      .from('hall_posts')
      .select('id, created_at')
      .order('created_at', { ascending: false })

    if (hallPosts?.length) {
      const hallUpdates = hallPosts.map((post, idx) => {
        let impressions
        if (idx < 100) {
          impressions = Math.floor(3000 + Math.random() * 7000)
        } else if (idx < 500) {
          impressions = Math.floor(500 + Math.random() * 3000)
        } else {
          impressions = Math.floor(Math.random() * 500)
        }
        return { id: post.id, impressions }
      })

      for (const update of hallUpdates) {
        await admin
          .from('hall_posts')
          .update({ impressions: update.impressions })
          .eq('id', update.id)
          .throwOnError()
      }
      console.log(`✓ Seeded ${hallPosts.length} hall posts`)
    }

    // Seed direct_messages
    console.log('Seeding direct_messages impressions...')
    const { data: messages } = await admin
      .from('direct_messages')
      .select('id, created_at')
      .order('created_at', { ascending: false })

    if (messages?.length) {
      const messageUpdates = messages.map((msg, idx) => {
        // Messages get fewer impressions since they're 1-on-1
        let impressions
        if (idx < 50) {
          impressions = Math.floor(500 + Math.random() * 2000)
        } else if (idx < 300) {
          impressions = Math.floor(100 + Math.random() * 500)
        } else {
          impressions = Math.floor(Math.random() * 100)
        }
        return { id: msg.id, impressions }
      })

      for (const update of messageUpdates) {
        await admin
          .from('direct_messages')
          .update({ impressions: update.impressions })
          .eq('id', update.id)
          .throwOnError()
      }
      console.log(`✓ Seeded ${messages.length} direct messages`)
    }

    console.log('✓ All impressions seeded successfully!')
  } catch (err) {
    console.error('Error seeding impressions:', err)
    process.exit(1)
  }
}

seedImpressions()
