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
    console.log('Fetching all posts...')
    const { data: posts, error: fetchError } = await admin
      .from('profile_posts')
      .select('id, profile_id, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError
    if (!posts?.length) {
      console.log('No posts found')
      return
    }

    console.log(`Found ${posts.length} posts, seeding impressions...`)

    // Seed impressions: top posts get 5K-12K, others get 100-4K
    const updates = posts.map((post, idx) => {
      let impressions
      if (idx < 100) {
        // Top 100 posts: 5K-12K impressions
        impressions = Math.floor(5000 + Math.random() * 7000)
      } else if (idx < 500) {
        // Next 400: 1K-5K impressions
        impressions = Math.floor(1000 + Math.random() * 4000)
      } else {
        // Rest: 0-1K impressions
        impressions = Math.floor(Math.random() * 1000)
      }

      return {
        id: post.id,
        impressions,
      }
    })

    // Batch update in chunks of 100
    for (let i = 0; i < updates.length; i += 100) {
      const chunk = updates.slice(i, i + 100)
      const { error: updateError } = await admin
        .from('profile_posts')
        .upsert(chunk, { onConflict: 'id' })

      if (updateError) throw updateError
      console.log(`Updated ${Math.min(i + 100, updates.length)}/${updates.length} posts`)
    }

    console.log('✓ Impressions seeded successfully!')
  } catch (err) {
    console.error('Error seeding impressions:', err)
    process.exit(1)
  }
}

seedImpressions()
