import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  const { user_id } = await req.json();

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // Update user's metadata with admin role
  const { data, error } = await supabaseClient
    .from('profiles')
    .update({ is_admin: true })
    .eq('id', user_id)
    .select() // It's good practice to select() to get the updated data or confirm success.
  if (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({ message: 'Admin role assigned successfully' }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})