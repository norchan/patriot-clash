import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { generateBotReply } from '@/lib/bot-chat'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isBlockedEitherWay } from '@/lib/blocks'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { moderateImage, recordCsamSuspect } from '@/lib/moderation'
import { notify } from '@/lib/notify'

function conversationId(a: string, b: string) {
  return [a, b].sort().join('_')
}

// GET /api/chat/[userId] — fetch message thread with a player
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { userId } = await params

    const convId = conversationId(profile.id, userId)

    const { data: messages } = await admin
      .from('direct_messages')
      .select('id, sender_id, content, image_url, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(100)

    return NextResponse.json({ messages: messages ?? [] })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/chat/[userId] — remove one of your own messages
// (?messageId=...) or the whole conversation (no messageId).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { userId } = await params
    const convId = conversationId(profile.id, userId)
    const messageId = req.nextUrl.searchParams.get('messageId')

    if (messageId) {
      // Single message — only the sender can delete their own
      const { data: msg } = await admin
        .from('direct_messages').select('id, sender_id, conversation_id')
        .eq('id', messageId).maybeSingle()
      if (!msg || msg.conversation_id !== convId) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }
      if (msg.sender_id !== profile.id) {
        return NextResponse.json({ error: 'You can only delete your own messages' }, { status: 403 })
      }
      await admin.from('direct_messages').delete().eq('id', messageId)
      return NextResponse.json({ deleted: messageId })
    }

    // No messageId → clear the whole thread (the caller is a participant by
    // construction, since convId is derived from their id + the other id)
    await admin.from('direct_messages').delete().eq('conversation_id', convId)
    return NextResponse.json({ deleted: 'conversation' })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/chat/[userId] — send a message to a player
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`chat:${profile.id}`, 20, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const { userId } = await params
    const { content, image } = await req.json()

    const text = (content ?? '').trim()
    if ((!text && !image) || text.length > 500) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    // Direct messages: anyone you can see, you can message. The only wall is
    // a block (either direction) — unwanted senders are handled by snoozing
    // or blocking them.
    const [{ data: receiver }, blocked] = await Promise.all([
      admin.from('profiles').select('id, clerk_user_id').eq('id', userId).single(),
      isBlockedEitherWay(admin, profile.id, userId),
    ])

    if (blocked) {
      return NextResponse.json({ error: 'Cannot message this player' }, { status: 403 })
    }
    if (!receiver) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const convId = conversationId(profile.id, userId)

    // Photo / GIF attachment — screened, then stored like post images.
    // DMs use the album policy (private space): when adult albums are on,
    // nudity passes; sex acts and anything minor-suspect never do.
    let imageUrl: string | null = null
    if (image) {
      const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(image)
      if (!match) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 })
      const buffer = Buffer.from(match[2], 'base64')
      if (buffer.length > 4 * 1024 * 1024) {
        return NextResponse.json({ error: 'Image too large (max 4 MB)' }, { status: 400 })
      }
      const verdict = await moderateImage(image, 'album')
      if (!verdict.allowed) {
        if (verdict.csamSuspected) {
          await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'dm_image', details: verdict.details })
        }
        return NextResponse.json({ error: verdict.reason ?? 'Image rejected' }, { status: 400 })
      }
      const path = `dms/${convId}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) {
        console.error('dm image upload failed:', upErr)
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
      }
      imageUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    const { data: message, error } = await admin
      .from('direct_messages')
      .insert({
        conversation_id: convId,
        sender_id: profile.id,
        receiver_id: userId,
        content: text || null,
        image_url: imageUrl,
      })
      .select()
      .single()

    if (error) throw error

    // One unread notification per conversation — no pile-up from rapid chats
    await notify(admin, {
      profileId: userId,
      type: 'dm',
      title: `💬 ${profile.username}`,
      body: text ? text.slice(0, 120) : '📷 Sent a photo',
      link: `/messages/${profile.id}`,
      dedupeUnreadLink: true,
    })

    // Bots text back — generated after the response so sends stay instant
    if (receiver.clerk_user_id?.startsWith('bot')) {
      after(() => generateBotReply(admin, userId, profile.id, convId))
    }

    return NextResponse.json({ message })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
