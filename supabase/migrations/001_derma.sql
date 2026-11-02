-- One-time update for a database that still has the old dental sample data.
-- Run once in the Supabase SQL Editor (or via the app's database connection). Safe to run again.
-- Dental services are hidden, not deleted, so any past bookings still point at a real row.

update services set active = 0
 where name in ('Dental cleaning', 'Tooth extraction', 'Tooth filling', 'Whitening');

update services
   set duration_min = 30, price = '', recall_months = null, aftercare = '',
       description = 'A skin assessment with a plan explained in plain language, so you know your options before any treatment.',
       active = 1
 where name = 'Consultation';

insert into services (name, duration_min, price, recall_months, aftercare, description) values
  ('Facial',             60,  '',                   null, '', 'A cleansing facial that deep-cleans and refreshes the skin.'),
  ('Hydrafacial',        60,  '',                   null, '', 'A hydrating treatment that cleanses, exfoliates, and nourishes the skin in one session.'),
  ('Botox',              60,  '',                   4,    '', 'Botulinum toxin treatment that softens expression lines. Your practitioner will check whether it suits you at your consultation.'),
  ('Fillers',            60,  '',                   null, '', 'Dermal filler to restore volume or smooth lines. Your practitioner will explain the options and risks at your consultation.'),
  ('Laser Hair Removal', 90,  '₱1,500 per session', null, '', 'Laser treatment that reduces unwanted hair over several sessions. Underarm sessions are ₱1,500 each, or ₱6,000 for a 5-session package.'),
  ('Chemical Peel',      60,  '',                   null, '', 'A chemical exfoliation to improve skin texture and tone. Your practitioner will recommend the right strength for your skin.'),
  ('Thread lift',        120, '',                   null, '', 'A minimally invasive lift using dissolvable threads for a refreshed look.')
on conflict (name) do nothing;

-- Practitioner names from the sample data
update dentists set name = 'Dr. Luna' where name = 'Dr. Reyes'
  and not exists (select 1 from dentists where name = 'Dr. Luna');

update settings set value = 'Demo Derma Clinic' where key = 'clinic_name' and value = 'Demo Dental Clinic';
