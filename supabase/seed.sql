-- ============================================================
-- SAMPLE DATA
-- Replace '20e124e5-232b-42f6-95f7-31f9c0802d7a' with a real user UUID from
-- Supabase Dashboard → Authentication → Users
-- ============================================================

do $$
declare
  v_user_id     uuid := '20e124e5-232b-42f6-95f7-31f9c0802d7a';
  v_conv_1_id   uuid := gen_random_uuid();
  v_conv_2_id   uuid := gen_random_uuid();
begin

  -- --------------------------------------------------------
  -- Conversation 1: Mentawai Islands planning session
  -- --------------------------------------------------------
  insert into public.conversations (id, user_id, title, created_at, updated_at)
  values (
    v_conv_1_id,
    v_user_id,
    'Mentawai Islands — October',
    now() - interval '2 days',
    now() - interval '2 days'
  );

  insert into public.messages (conversation_id, role, content, created_at) values
  (
    v_conv_1_id, 'user',
    'I want to plan a surf trip to the Mentawai Islands in Indonesia. We''re thinking mid-October for about 10 days. There are 3 of us, intermediate to advanced surfers. What should we know?',
    now() - interval '2 days' + interval '1 minute'
  ),
  (
    v_conv_1_id, 'assistant',
    'The Mentawais in mid-October is a great call — it sits right at the tail end of the dry season (May–October), so you''re catching the last reliable swell window before the weather turns. Here''s what to expect:

**Conditions**
Peak swell season runs June–September, but October still delivers solid 4–6ft+ sets, especially at the southern breaks. Offshore winds are typically light in the morning, turning onshore by afternoon. Water temperature sits around 27–28°C — boardshorts and a rash guard is all you need.

**The breaks**
The Mentawais have 50+ breaks, but for intermediate-to-advanced surfers, the headline spots are:
- **Macaronis** — long, predictable lefthander, one of the most consistent waves in the world. Intermediate-friendly with longer rides.
- **Rifles** — barreling right, more advanced. Works best at 4–6ft.
- **HT''s (Lance''s Right)** — world-class right-hander, powerful and hollow at size. Advanced.
- **Telescopes** — heavy left, not for the faint-hearted.

**Getting there**
Fly into Padang (PDG) via Jakarta (CGK) or Singapore (SIN). From Padang, you have two options:
1. Fast boat to Tua Pejat (~3–4 hrs) — cheaper, rougher
2. Charter a live-aboard boat — the preferred option. Prices range from $1,800–$3,500 USD per person for 10 days depending on the vessel.

**Live-aboard vs. land-based**
For 10 days and 3 surfers, a boat charter is strongly recommended. It lets you follow the swell, anchor at uncrowded breaks, and cover far more ground than staying in one resort. Splitting a charter between 3 people is very cost-effective.

**Budget estimate (per person, 10 days)**
- Flights (from US/Europe): $900–$1,400
- Boat charter share: $2,000–$3,000
- Visa on arrival (Indonesia): $35
- Board bag fees: $100–$200 (airlines vary)
- Total: ~$3,000–$5,000 per person

**What to book first**
Boat charters fill up months in advance for peak season. October slots may still be available but move fast. I''d recommend locking in the boat before anything else.

Want me to break down specific boat operators, the best strategy for booking flights, or more detail on any of the breaks?',
    now() - interval '2 days' + interval '2 minutes'
  ),
  (
    v_conv_1_id, 'user',
    'What''s the crowd situation like at Macaronis vs HT''s? And what''s the best month to go if we want less crowds?',
    now() - interval '2 days' + interval '10 minutes'
  ),
  (
    v_conv_1_id, 'assistant',
    '**Macaronis** is the most crowded wave in the Mentawais — it''s predictable, long, and photogenic, which means it draws boat traffic from every charter in range. On a solid swell day in peak season, expect 30–50 surfers out. The wave is long enough to spread people out, but the takeoff zone still gets competitive. Being on a boat is an advantage: you can time your session to hit it at dawn or midweek when other charters are elsewhere.

**HT''s (Lance''s Right)** draws a more experienced crowd but also gets heavy traffic — it''s one of the most photographed waves in the archipelago. Expect similar numbers on good days.

For less crowds, the gameplan is to chase the boats to the outer islands rather than surfing the headline breaks. Your skipper will know where the crowds are thin that day.

**Best month for low crowds**
The honest answer: there''s no magic month. The Mentawais are a charter surf destination, and wherever the swell is good, boats will be. That said:

- **May and October** are the shoulder months — swell is still there but slightly less consistent. Fewer boats make the trip, crowds are noticeably lighter.
- **November–April** is the wet season — swell gets inconsistent and rainy. Not recommended unless you''re chasing a specific forecast window.
- **June–September** is peak. Best swell, most boats.

**Mid-October is actually a good sweet spot.** You get the end of dry season conditions, lighter traffic than July/August, and a real chance of finding breaks with 5–10 people out instead of 40.

One more thing: if any of your group can get to the boat for a 5am pre-dawn position, you''ll have Macaronis to yourselves for the first hour of light. Easily worth the early alarm.',
    now() - interval '2 days' + interval '11 minutes'
  );

  -- --------------------------------------------------------
  -- Conversation 2: Bali beginner scouting
  -- --------------------------------------------------------
  insert into public.conversations (id, user_id, title, created_at, updated_at)
  values (
    v_conv_2_id,
    v_user_id,
    'Bali — learning to surf, March',
    now() - interval '5 hours',
    now() - interval '5 hours'
  );

  insert into public.messages (conversation_id, role, content, created_at) values
  (
    v_conv_2_id, 'user',
    'I''m a complete beginner and want to learn to surf in Bali in March. I''ll have about 2 weeks. Where should I go and what should I expect?',
    now() - interval '5 hours' + interval '1 minute'
  ),
  (
    v_conv_2_id, 'assistant',
    'Bali is one of the best places in the world to learn to surf — plenty of mellow beach breaks, tons of surf schools, and warm water year-round. March falls in the wet season (Nov–April) but that doesn''t mean bad conditions. Here''s the breakdown:

**Best spots for beginners in Bali**

**Kuta Beach** — the original surf school hub. Long sandy beach, consistent small shore break, hundreds of instructors. Crowded and touristy but genuinely good for learning. Waves are usually 1–3ft and forgiving. Cheap lessons (~$15–25 USD/hour).

**Legian** — a short walk north of Kuta, slightly less crowded, same quality of wave.

**Seminyak** — more upscale area, quieter beach, similar beginner-friendly conditions.

**Canggu (Echo Beach / Batu Bolong)** — slightly more advanced than Kuta. Better vibe, better coffee, more of a surf community feel. Batu Bolong has a gentle right that''s good once you can pop up consistently.

**What to expect in March**
- **Swell:** West and south swells, typically 2–5ft at exposed breaks. Beach breaks in Kuta/Canggu stay manageable at 1–3ft for beginners.
- **Wind:** Onshore winds more common in the wet season. Mornings are usually the best window — glassy conditions before 8–9am.
- **Rain:** Afternoon showers are common but usually short. Doesn''t affect surfing much.
- **Water temp:** 27–29°C. Rash guard at most.

**2-week progression plan**
- Days 1–4: Kuta or Legian, group lessons. Focus on paddling, popping up, riding whitewater.
- Days 5–8: Private lessons at Canggu once you''re popping up consistently. Start catching unbroken waves.
- Days 9–14: Free surf at Batu Bolong or Echo Beach morning sessions. Rent a board by the day (~$5–10).

**Budget estimate (2 weeks)**
- Flights: $700–$1,200 depending on origin
- Accommodation (Canggu guesthouse/surf hostel): $20–60/night = $280–840
- Surf lessons (10 hours total): ~$150–250
- Board rental (rest of trip): ~$70–100
- Food: $15–30/day
- Total: ~$1,500–$2,800

**One tip:** Book accommodation in Canggu and day-trip to Kuta for your first few lessons. Canggu has better food, a real local surf scene, and you''ll enjoy hanging around there between sessions.',
    now() - interval '5 hours' + interval '2 minutes'
  );

end $$;
