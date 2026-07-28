// LA Beta onboarding: Profile + Intake (Final). No maxes on multi_select.
// Types: text | date | chips_single | location_permission | multi_select | searchable_multi | searchable_single | select | slider_snap

import { ETHNICITY_OPTIONS } from '@/lib/ethnicity-options'

export type StepType =
  | 'text'
  | 'date'
  | 'chips_single'
  | 'location_permission'
  | 'multi_select'
  | 'searchable_multi'
  | 'searchable_single'
  | 'select'
  | 'slider_snap'

export type ProfileStep = {
  id: string
  question: string
  type: StepType
  body?: string
  required?: boolean
  options?: string[]
  placeholder?: string
  minAge?: number
  maxSelections?: number
  minSelections?: number
  /** Max length for user-typed entries (searchable_multi / searchable_single). */
  customAnswerMaxLength?: number
  /** searchable_single: option chips shown before the user types (full list still used when searching). */
  featuredOptions?: string[]
  /** Short line above featured chips (e.g. work life-situation shortcuts). */
  featuredOptionsCaption?: string
}

export const NEIGHBORHOOD_OPTIONS: string[] = [
  // Los Angeles — Eastside
  'Silver Lake', 'Echo Park', 'Los Feliz', 'Atwater Village', 'Glassell Park',
  'Eagle Rock', 'Highland Park', 'Cypress Park', 'Frogtown', 'Mount Washington',
  'Elysian Park', 'Boyle Heights',
  // Los Angeles — Downtown
  'Downtown LA (DTLA)', 'Arts District', 'Little Tokyo', 'Chinatown',
  'Fashion District', 'Historic Core', 'Financial District',
  // Los Angeles — Mid-City / Koreatown
  'Koreatown', 'Mid-Wilshire', 'Larchmont Village', 'Hancock Park',
  'Windsor Square', 'Miracle Mile', 'Fairfax',
  // Los Angeles — Hollywood
  'Hollywood', 'West Hollywood', 'Hollywood Hills', 'Laurel Canyon', 'Beachwood Canyon',
  // Los Angeles — Westside
  'Beverly Hills', 'Bel Air', 'Brentwood', 'Pacific Palisades', 'Westwood',
  'Century City', 'Cheviot Hills', 'Rancho Park', 'West LA',
  // Los Angeles — Beach Cities
  'Santa Monica', 'Venice', 'Marina del Rey', 'Playa Vista', 'Playa del Rey',
  'El Segundo', 'Manhattan Beach', 'Hermosa Beach', 'Redondo Beach', 'Torrance', 'Malibu',
  // Los Angeles — Culver City area
  'Culver City', 'Mar Vista', 'Palms',
  // Los Angeles — South
  'Leimert Park', 'Baldwin Hills', 'View Park', 'Windsor Hills', 'Ladera Heights',
  'Crenshaw', 'Hyde Park', 'Inglewood', 'Hawthorne', 'Gardena', 'Carson',
  'Watts', 'Compton', 'Lynwood', 'South Gate', 'Huntington Park', 'Downey', 'Paramount',
  // Los Angeles — San Gabriel Valley
  'Pasadena', 'Arcadia', 'Monrovia', 'Sierra Madre', 'Temple City', 'Rosemead',
  'San Marino', 'Duarte', 'Alhambra', 'San Gabriel', 'Monterey Park',
  'El Monte', 'Baldwin Park', 'West Covina', 'Covina', 'Azusa', 'Glendora',
  'La Puente', 'Irwindale',
  // Los Angeles — Glendale / Burbank
  'Glendale', 'Burbank', 'La Cañada Flintridge', 'Sunland-Tujunga',
  // Los Angeles — Southeast
  'Whittier', 'Pico Rivera', 'Montebello', 'Commerce', 'Cerritos', 'Lakewood',
  // Long Beach
  'Downtown Long Beach', 'Belmont Shore', 'Bixby Knolls', 'Signal Hill',
  // San Fernando Valley
  'Studio City', 'Sherman Oaks', 'Encino', 'Tarzana', 'Woodland Hills', 'Calabasas',
  'Chatsworth', 'Northridge', 'Granada Hills', 'Porter Ranch', 'Reseda', 'Van Nuys',
  'Panorama City', 'North Hollywood', 'Valley Village', 'Toluca Lake', 'Lake Balboa',
  'West Hills', 'Canoga Park', 'Winnetka',
  // Orange County — North
  'Anaheim', 'Anaheim Hills', 'Fullerton', 'Brea', 'Placentia', 'Yorba Linda',
  'Orange', 'Tustin', 'Garden Grove', 'Westminster', 'Little Saigon', 'Stanton',
  'Buena Park', 'La Habra', 'Cypress', 'Los Alamitos', 'Seal Beach', 'La Palma',
  // Orange County — Central
  'Santa Ana', 'Costa Mesa', 'Irvine', 'Newport Beach', 'Corona del Mar',
  'Fountain Valley', 'Huntington Beach',
  // Orange County — South
  'Laguna Beach', 'Laguna Hills', 'Laguna Niguel', 'Laguna Woods', 'Mission Viejo',
  'Lake Forest', 'Aliso Viejo', 'Rancho Santa Margarita', 'Dana Point',
  'San Clemente', 'San Juan Capistrano',
  // Inland Empire — West (Pomona Valley)
  'Pomona', 'Diamond Bar', 'Walnut', 'Chino', 'Chino Hills', 'Ontario',
  'Rancho Cucamonga', 'Upland', 'Claremont', 'Montclair', 'La Verne', 'San Dimas',
  // Inland Empire — Central
  'Riverside', 'Moreno Valley', 'Corona', 'Norco', 'Jurupa Valley',
  // Inland Empire — San Bernardino Valley
  'San Bernardino', 'Redlands', 'Loma Linda', 'Highland', 'Rialto',
  'Fontana', 'Colton', 'Grand Terrace',
  // Inland Empire — Temecula Valley
  'Murrieta', 'Temecula', 'Lake Elsinore', 'Menifee', 'Perris', 'Hemet',
  // Inland Empire — High Desert
  'Victorville', 'Hesperia', 'Apple Valley', 'Barstow',
]

/** Ordered stops for the “how long in this market” slider (left → right). */
export const MARKET_TENURE_OPTIONS: string[] = [
  'Just moved',
  'Less than 6 months',
  '6 months – under 1 year',
  '1–2 years',
  '3–5 years',
  '6–10 years',
  '11–20 years',
  '20+ years',
  'I grew up here',
]

// PROFILE: name, demographics, location
export const PROFILE_STEPS: ProfileStep[] = [
  {
    id: 'first_name',
    question: "What's your first name?",
    type: 'text',
    required: true,
    placeholder: 'Your name',
  },
  {
    id: 'birthdate',
    question: "When's your birthday?",
    body: 'You must be 18+ to use this app.',
    type: 'date',
    required: true,
    minAge: 18,
    placeholder: 'Month, day, and year',
  },
  {
    id: 'gender',
    question: 'What gender do you identify as?',
    type: 'chips_single',
    required: true,
    options: ['Woman', 'Man', 'Non-binary'],
  },
  {
    id: 'languages',
    question: 'What languages do you speak fluently?',
    body: 'Select all that apply.',
    type: 'multi_select',
    required: true,
    options: [
      'English',
      'Spanish',
      'Mandarin',
      'Cantonese',
      'Korean',
      'Japanese',
      'Vietnamese',
      'Tagalog',
      'Hindi',
      'Arabic',
      'French',
      'German',
      'Italian',
      'Portuguese',
      'Russian',
      'Polish',
      'Armenian',
      'Persian',
      'Hebrew',
      'Thai',
      'Indonesian',
      'Turkish',
      'Greek',
      'Gujarati',
      'Dutch',
      'Swedish',
      'Czech',
      'Romanian',
      'Hungarian',
      'Ukrainian',
      'Bengali',
      'Punjabi',
      'Tamil',
      'Urdu',
      'Malay',
      'Other',
      'Prefer not to say',
    ],
  },
  {
    id: 'location',
    question: 'Where are you located?',
    body: 'Your location stays private.',
    type: 'location_permission',
    required: true,
  },
]

// INTAKE: shown after location in onboarding; persisted on intake_responses_v5.
export const INTAKE_STEPS: ProfileStep[] = [
  {
    id: 'q_market_tenure',
    question: 'How long have you lived in this area?',
    type: 'chips_single',
    required: true,
    options: [
      'Just moved',
      'Less than a year',
      '1–3 years',
      '3–10 years',
      'Over 10 years',
      'Grew up here',
    ],
  },
  {
    id: 'q_ethnicity',
    question: 'What cultures do you identify with?',
    type: 'searchable_multi',
    required: false,
    options: ETHNICITY_OPTIONS,
  },
  {
    id: 'q_interests',
    question: 'What are some of your interests?',
    body: 'Select all that apply.',
    type: 'multi_select',
    required: true,
    options: [
      'Reading',
      'Music',
      'Film & TV',
      'Podcasts',
      'Cooking',
      'Travel',
      'Fitness',
      'Dance',
      'Basketball',
      'Football',
      'Soccer',
      'Baseball',
      'Running',
      'Hiking',
      'Outdoors',
      'Yoga / Pilates',
      'Weightlifting',
      'Cycling',
      'Swimming',
      'Tennis',
      'Pickleball',
      'Photography',
      'Art & design',
      'Writing',
      'Gaming',
      'Entrepreneurship & startups',
      'Investing & finance',
      'History',
      'Science',
      'Philosophy',
      'Politics & current events',
    ],
  },
  /*
  {
    id: 'q_hoping_for',
    question: 'What are you hoping for from Fika?',
    type: 'chips_single',
    required: true,
    options: [
      'Conversation with new people — not necessarily friendship',
      'Meeting people nearby — open to friendship if it happens',
      'Actively looking for new friends',
    ],
  },
  */
  {
    id: 'q_like_talking_about',
    question: "What are some things you'd like to talk about?",
    body: 'Choose up to 7 — we use this to suggest people you may click with.',
    type: 'multi_select',
    required: true,
    maxSelections: 7,
    options: [
      'Something fun I did recently',
      'A hobby I just took up',
      'A recent win (big or small)',
      "Something I'm working on right now",
      'Something that made me laugh lately',
      "A show I'm currently watching",
      "What I've been listening to lately (music/podcasts)",
      'How my fave sports team is doing this season',
      'Modern dating (the good, bad, ugly)',
      'My social life these days',
      'Something in the news I have thoughts on',
      'Something trending online right now',
      'What a meaningful life looks like to me',
      'A recent trip I took or am taking',
      "Local spots I've been loving lately (food, bars, activities)",
      'Random theories & "what if" ideas',
      'What my routine looks like lately (gym, habits, etc.)',
    ],
  },
  {
    id: 'q_social_goal',
    question: 'What are you hoping to get out of Fika?',
    body: 'Pick up to 3.',
    type: 'multi_select',
    required: false,
    maxSelections: 3,
    options: [
      'Meet people outside my usual circle',
      'Find friends to do activities with',
      'Have more interesting conversations',
      'Build my social life in a new city',
      'Get outside my comfort zone',
      'Meet people with different backgrounds',
      'Find a regular activity buddy',
    ],
  },
  {
    id: 'q_friend_description',
    question: 'How would close friends describe you?',
    type: 'chips_single',
    required: false,
    options: [
      'Warm and easy to talk to',
      'Curious and intellectual',
      'Funny and lighthearted',
      'Driven and ambitious',
      'Creative and expressive',
      'Calm and thoughtful',
      'Adventurous and spontaneous',
      'Honest and direct',
      'A great listener',
      'The one who brings people together',
    ],
  },
  {
    id: 'q_work',
    question: 'What do you do for work?',
    body: "Optional — be as specific or general as you like. If you're between roles or on a break, feel free to say so.",
    type: 'text',
    required: false,
    customAnswerMaxLength: 100,
    placeholder: 'e.g. Software Engineer at a Startup',
  },
  {
    id: 'confirm_intent',
    question: 'Before you continue',
    body: "Fika sets up two types of meetups: Fika socials (a group gathering where we pair you with one person 30 minutes before), and 1-on-1 intros (just the two of you — no group). We'll reach out when we have something for you — just reply Yes and we'll handle the rest.\n\nMeet in public and use good judgment. We're here for respectful conversation. By continuing, you agree to show up with care for yourself and others.",
    type: 'chips_single',
    required: true,
    options: ["I'm in"],
  },
]

export const TOTAL_ONBOARDING_STEPS = PROFILE_STEPS.length + INTAKE_STEPS.length

/*
Previous INTAKE_STEPS snapshot (commented out of the active array; kept for reference).
Re-enable by merging back into INTAKE_STEPS and restoring imports (countries, colleges, media JSON, etc.).

export const INTAKE_STEPS_PREVIOUS_REFERENCE = [
  {
    id: 'q_home_country',
    question: 'Home country',
    body: "Where you're from",
    type: 'select',
    required: false,
    options: COUNTRY_NAMES_FOR_SELECT,
  },
  {
    id: 'q_home_state',
    question: 'Home state',
    body: 'State where you grew up.',
    type: 'select',
    required: false,
    options: US_STATE_NAMES,
  },
  {
    id: 'q_college',
    question: 'Where do or did you go to school?',
    body: "Undergrad or grad is fine; if this doesn't apply, leave blank.",
    type: 'searchable_single',
    required: false,
    customAnswerMaxLength: 100,
    placeholder: 'Optional — type to search or enter your school',
    options: [...collegeNames],
  },
  {
    id: 'q_ethnicity',
    question: 'Ethnicity',
    type: 'select',
    required: false,
    options: ETHNICITY_OPTIONS,
  },
  {
    id: 'q_relationship_status',
    question: "What's your relationship status?",
    type: 'select',
    required: false,
    options: RELATIONSHIP_STATUS_OPTIONS,
  },
  {
    id: 'q_life_chapter',
    question: 'What life chapter are you in now?',
    body: 'Select all that apply.',
    type: 'multi_select',
    required: true,
    options: [
      "I'm in college or university",
      "I'm in graduate school",
      'I recently graduated',
      "I'm early in my career",
      "I'm growing in my career",
      "I'm established in my career",
      "I'm building something (startup, project, business)",
      "I'm working independently or freelancing",
      "I'm transitioning into a new career",
      'I recently moved to this city',
      'I recently got married or entered a long-term partnership',
      "I'm exploring a new direction",
      "I'm taking time to figure out what's next",
      "I'm taking a break or sabbatical",
      "I'm starting a family",
      "I'm raising kids",
      "I'm caring for family members",
      "I'm semi-retired",
      "I'm retired",
    ],
  },
  {
    id: 'q_everyday_anchor',
    question: "What tends to anchor your day-to-day life right now?",
    body: 'Select all that apply.',
    type: 'multi_select',
    options: [
      'Work',
      'Side hustles',
      'Job search',
      'School',
      'Family life',
      'Parenting',
      'Family caregiving',
      'Romantic relationship',
      'Close friendships',
      'Fitness routine',
      'Creative projects',
      'Community or volunteering',
      'Faith or spiritual practice',
      'Travel',
      'Something else',
    ],
  },
  {
    id: 'q_curiosity',
    question: "Which of these sounds most like something you'd pick up?",
    body: 'Select all that apply.',
    type: 'multi_select',
    options: [
      'Take a pottery class',
      'Learn how to paint',
      'Learn an instrument',
      'Take a dance class',
      'Take a cooking class',
      'Start learning a new language',
      'Join a storytelling workshop',
      'Take a photography course',
      'Start a fitness program',
      'Join a local sports league',
      'Take a coding course',
      'Take an AI course',
      'Take a philosophy class',
      'Take an improv class',
      'Take a human behavior course',
      'Join a public speaking group',
      'Take a course on how to build a business',
      'Take a class on personal finance',
    ],
  },
  {
    id: 'q_tv_streaming_shows',
    question: 'Shows you're into',
    body: 'Type to search our list, tap to add, or use your own title anytime. Pick up to eight.',
    type: 'searchable_multi',
    required: false,
    maxSelections: 8,
    customAnswerMaxLength: 100,
    options: [...tvStreamingTitles],
  },
  {
    id: 'q_podcasts',
    question: 'Podcasts you listen to',
    body: 'Type to search our list, tap to add, or use your own title anytime. Pick up to eight.',
    type: 'searchable_multi',
    required: false,
    maxSelections: 8,
    customAnswerMaxLength: 100,
    options: [...podcastTitles],
  },
  {
    id: 'q_favorite_artists',
    question: 'Musical artists or bands you're into',
    body: 'Type to search our list, tap to add, or use your own anytime. Pick up to eight.',
    type: 'searchable_multi',
    required: false,
    maxSelections: 8,
    customAnswerMaxLength: 100,
    options: [...musicArtistNames],
  },
  {
    id: 'q_favorite_teams',
    question: 'Sports teams you follow',
    body: 'Type to search our list, tap to add, or use your own anytime. Pick up to eight.',
    type: 'searchable_multi',
    required: false,
    maxSelections: 8,
    customAnswerMaxLength: 100,
    options: [...sportsTeamNames],
  },
  {
    id: 'q_what_makes_great_fika',
    question: 'What would make a great Fika conversation for you?',
    body: 'Select all that apply.',
    type: 'multi_select',
    required: true,
    options: [
      'Swapping stories from our lives (chapters, how we got here)',
      'Stuff we're into lately (books, shows, podcasts, games)',
      'Recent travel and places you've visited',
      'What we're working on (work or projects)',
      'Giving/getting advice for professional & personal growth',
      'Life in our city (neighborhoods, restaurants, hangout spots)',
      'Big questions and how we see the world',
      'Hobbies and things we'd like to try next',
    ],
  },
  {
    id: 'q_avoid_topics',
    question: "Anything you'd rather steer clear of?",
    type: 'multi_select',
    required: false,
    options: [
      'Politics',
      'Religion',
      'Work & career',
      'Relationship status',
      'Health',
      'Personal finances',
      'Nothing in particular',
      'Prefer not to say',
    ],
  },
  {
    id: 'q_openness',
    question: 'Who would you be open to meet for a Fika?',
    type: 'chips_single',
    required: true,
    options: [
      "Someone I'd instantly relate to",
      'Someone outside my usual bubble',
      "I'm open to anyone",
    ],
  },
  {
    id: 'gender_preference',
    question: "Do you have a gender preference for who you'd like to meet?",
    body: 'Fika is intended for platonic conversations.',
    type: 'chips_single',
    required: true,
    options: ['No preference', 'Same gender', 'Different gender'],
  },
  {
    id: 'q_hoping_for',
    question: 'What are you hoping for from Fika?',
    type: 'chips_single',
    required: true,
    options: [
      'Conversation with new people — not necessarily friendship',
      'Meeting people nearby — open to friendship if it happens',
      'Actively looking for new friends',
    ],
  },
  {
    id: 'q_radius',
    question: 'How far are you willing to travel for a Fika?',
    type: 'chips_single',
    required: true,
    options: ['5 miles', '10 miles', '25 miles', '50 miles'],
  },
  {
    id: 'q_typical_fika_times',
    question: 'When are you most likely to be free for a Fika?',
    body: 'Select all that typically work — we use this to suggest times that fit both people.',
    type: 'multi_select',
    required: true,
    options: [
      'Weekday mornings',
      'Weekday afternoons',
      'Weekday evenings',
      'Weekend mornings',
      'Weekend afternoons',
      'Weekend evenings',
    ],
  },
  {
    id: 'confirm_intent',
    question: 'Fika is built for thoughtful, platonic connection.',
    body: "We're here to help people meet others nearby for real conversation. Any behavior that doesn't align may result in removal.",
    type: 'chips_single',
    required: true,
    options: ["I'm in"],
  },
]
*/
