import { PROFESSION_OPTIONS } from '@/lib/profession-options'

function mergeUniqueCaseInsensitive(priority: string[], rest: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...priority, ...rest]) {
    const t = raw.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/**
 * Order matters: inclusive life situations and common non-tech roles first,
 * then the rest of `PROFESSION_OPTIONS` (deduped).
 */
const WORK_ROLE_PRIORITY: string[] = [
  // Inclusive — not in paid work or between paths
  'Currently unemployed',
  'Between jobs',
  'Stay-at-home parent',
  'Full-time caregiver at home',
  'Taking a career break',
  'On sabbatical',
  'Retired',
  'Student',
  // Founders & product (tech-adjacent)
  'Founder',
  'Co-founder',
  'Entrepreneur',
  'Product manager',
  'Project manager',
  'Program manager',
  'Software engineer',
  'Software developer',
  'Data scientist',
  'Designer',
  'UX designer',
  'Marketing manager',
  'Sales manager',
  'Business analyst',
  // Healthcare
  'Registered nurse',
  'Nurse practitioner',
  'Nurse',
  'Medical assistant',
  'Physician',
  'Doctor',
  'Dentist',
  'Pharmacist',
  'Physical therapist',
  'Dental hygienist',
  'Home health aide',
  'Phlebotomist',
  // Education
  'Teacher',
  'Professor',
  'Teaching assistant',
  'School counselor',
  // Trades & logistics
  'Electrician',
  'Plumber',
  'Carpenter',
  'Welder',
  'Mechanic',
  'HVAC technician',
  'Construction worker',
  'Warehouse worker',
  'Truck driver',
  'Delivery driver',
  'Automotive technician',
  // Hospitality, retail, food service
  'Chef',
  'Line cook',
  'Baker',
  'Barista',
  'Waiter or waitress',
  'Cashier',
  'Retail manager',
  'Store manager',
  'Hotel manager',
  'Housekeeper',
  'Janitor',
  // Office & people-facing
  'Administrative assistant',
  'Receptionist',
  'Customer service representative',
  'Sales representative',
  'Recruiter',
  'Human resources',
  // Beauty & wellness
  'Hair stylist',
  'Massage therapist',
  'Cosmetologist',
  'Personal trainer',
  // Safety & public service
  'Police officer',
  'Firefighter',
  'Paramedic',
  'EMT',
  'Security guard',
  'Military',
  // Care & community
  'Social worker',
  'Childcare worker',
  'Nanny',
  'Therapist',
  'Counselor',
  // Creative & media
  'Photographer',
  'Writer',
  'Journalist',
  'Artist',
  'Musician',
  'Video editor',
  // Professional services
  'Attorney',
  'Lawyer',
  'Accountant',
  'Financial advisor',
  'Real estate agent',
  'Insurance agent',
  // Other common paths
  'Farmer',
  'Scientist',
  'Researcher',
  'Engineer',
  'Architect',
  'Pilot',
  'Flight attendant',
]

/** Chips shown before the user types (subset of `WORK_ROLE_OPTIONS`). */
export const WORK_ROLE_FEATURED: string[] = WORK_ROLE_PRIORITY.slice(0, 44)

export const WORK_ROLE_OPTIONS: string[] = mergeUniqueCaseInsensitive(WORK_ROLE_PRIORITY, PROFESSION_OPTIONS)
