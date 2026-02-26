// Profile steps (5) + intent confirm, then intake steps (10).
// Types: text | date | chips_single | location_permission | multi_select | slider | open_ended

export type StepType =
  | 'text'
  | 'date'
  | 'chips_single'
  | 'location_permission'
  | 'multi_select'
  | 'slider'
  | 'open_ended'

export type ProfileStep = {
  id: string
  question: string
  type: StepType
  /** Optional body copy shown below the question (e.g. for confirm_intent). Use \n\n for paragraphs. */
  body?: string
  required?: boolean
  options?: string[]
  placeholder?: string
  // for date: 18+ validation
  minAge?: number
  // for multi_select: max selections
  maxSelections?: number
  minSelections?: number
  // for slider: [min, max], default value; or discrete steps (sliderSteps)
  sliderRange?: [number, number]
  sliderSteps?: number[] // e.g. [5, 10, 25, 50] — slider snaps to these values only
  sliderDefault?: number
  sliderLabel?: (v: number) => string
}

// Profile steps 1–5 + confirm intent (step 6)
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
    question: "When's your birthday? (You must be 18+ to use this app)",
    type: 'date',
    required: true,
    minAge: 18,
  },
  {
    id: 'gender',
    question: "What's your gender?",
    type: 'chips_single',
    options: ['Woman', 'Man', 'Non-binary', 'Other', 'Prefer not to say'],
  },
  {
    id: 'pronouns',
    question: 'What are your pronouns? (Optional)',
    type: 'chips_single',
    options: ['He/Him', 'She/Her', 'They/Them', 'Other', 'Prefer not to say'],
  },
  {
    id: 'gender_preference',
    question: 'Do you have a gender preference for who you\'d like to meet?',
    type: 'chips_single',
    options: [
      'No preference',
      'Prefer to meet women',
      'Prefer to meet men',
      'Prefer to meet non-binary people',
    ],
  },
  {
    id: 'languages',
    question: 'What languages do you speak?',
    body: 'Select all that apply. This helps us match you with people you can connect with.',
    type: 'multi_select',
    options: [
      'English',
      'Spanish',
      'Chinese (Mandarin)',
      'Chinese (Cantonese)',
      'Tagalog',
      'Vietnamese',
      'French',
      'Arabic',
      'Korean',
      'Hindi',
      'Portuguese',
      'Russian',
      'German',
      'Haitian Creole',
      'Polish',
      'Italian',
      'Japanese',
      'Punjabi',
      'Gujarati',
      'Bengali',
      'Greek',
      'Persian',
      'Urdu',
      'Hebrew',
      'Thai',
      'Tamil',
      'Armenian',
      'Hmong',
      'Navajo',
      'Amharic',
      'Somali',
      'Nepali',
      'Khmer (Cambodian)',
      'Lao',
      'Hungarian',
      'Romanian',
      'Dutch',
      'Swahili',
      'Other',
      'Prefer not to say',
    ],
  },
  {
    id: 'location',
    question:
      "To suggest meetup spots and people near you, I'll need your location…",
    type: 'location_permission',
    required: true,
  },
  {
    id: 'confirm_intent',
    question: "I'd like to have real conversations.",
    body: "Fika is built for thoughtful, platonic connection.\n\nWe're here to meet new people for real conversation, shared interests, and meaningful experiences — clearly and respectfully.",
    type: 'chips_single',
    options: ["I'm in"],
    required: true,
  },
]

// Intake steps — ordered: who you are → how you connect → who you're open to → practicals → optional wrap
export const INTAKE_STEPS: ProfileStep[] = [
  // Who you are / where you're at
  {
    id: 'q2_life_chapter',
    question: 'What chapter are you in right now? (Choose up to 3)',
    body: 'Choose the ones that feel closest:',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'Exploring and figuring things out',
      'Building something meaningful',
      'Growing in my career or craft',
      'Raising or supporting a family',
      'Reinventing or pivoting',
      'Reflecting and sharing what I\'ve learned',
    ],
  },
  {
    id: 'q3_work_study',
    question: 'What do you do for work or study? (Select all that apply.)',
    type: 'multi_select',
    options: [
      'Full-time employed',
      'Part-time employed',
      'Freelance / contractor',
      'Self-employed / business owner',
      'Student (undergraduate)',
      'Student (graduate)',
      'Stay-at-home parent',
      'Retired',
      'Between jobs',
      'Career break / sabbatical',
      'Intern',
      'Volunteer',
      'In school (not degree-seeking)',
      'Prefer not to say',
      'Other',
    ],
  },
  {
    id: 'q3_work_study_detail',
    question: "Add more about your work or study if it's an important part of who you are.",
    body: 'industry, company, role, university, major — however much or little you want to share!',
    type: 'open_ended',
    placeholder: 'Optional',
  },
  {
    id: 'q5_talk_about',
    question: 'What are some of your interests? (Select all that apply)',
    type: 'multi_select',
    options: [
      'Fitness',
      'Running',
      'Walking',
      'Hiking',
      'Cycling',
      'Swimming',
      'Yoga',
      'Pilates',
      'Movement',
      'Reading',
      'Writing',
      'Music',
      'Art',
      'Design',
      'Creativity',
      'Cooking',
      'Food',
      'Dining out',
      'Film & TV',
      'Sports',
      'Board games',
      'Tech',
      'Building things',
      'Entrepreneurship',
      'Work',
      'Travel',
      'Volunteering',
      'Community',
      'Current events',
      'Ideas',
    ],
  },
  // How you like to connect
  {
    id: 'q1_conversation_types',
    question:
      'What kind of conversations are you craving more of lately? (Choose up to 4)',
    type: 'multi_select',
    maxSelections: 4,
    options: [
      'Relationships and connection',
      'Career and ambition',
      'Creativity and ideas',
      'Big life questions',
      'Fun and humor',
      'Current events and the world',
      'Shared interests (hobbies, stuff we do)',
    ],
  },
  {
    id: 'q10_first_conversation_feel',
    question: 'How do you like a first conversation to feel?',
    body: 'This captures energy — which matters more than topics.',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'Light and easy',
      'Thoughtful and reflective',
      'Curious and exploratory',
      'Deep dive into one topic',
      'A mix — see where it goes',
    ],
  },
  {
    id: 'q4_where_most_yourself',
    question: 'What meetup format sounds good for a Fika? (Select all that apply)',
    type: 'multi_select',
    options: [
      'Over coffee',
      'In motion (walks, hikes)',
      'Doing something creative',
    ],
  },
  // Who you're open to meeting
  {
    id: 'q6_who_excited_to_meet',
    question: 'Who would you be open to meet for a Fika? (Choose up to 3)',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'Someone in a similar life season',
      'Someone a few steps ahead of me',
      'Someone just starting out',
      'Someone in a completely different chapter',
      "I'm open — surprise me",
    ],
  },
  // Practicals
  {
    id: 'q9_availability',
    question: 'When are you usually up for a good conversation? (Choose at least 1)',
    type: 'multi_select',
    minSelections: 1,
    options: [
      'Weekday daytime',
      'Weekday evening',
      'Weekend daytime',
      'Weekend evening',
    ],
  },
  {
    id: 'q8_distance_miles',
    question: 'How far are you willing to travel for a Fika?',
    type: 'slider',
    sliderSteps: [5, 10, 25, 50],
    sliderDefault: 10,
    sliderLabel: (v) => `${v} miles`,
  },
  // Optional wrap
  {
    id: 'q11_season_of_life',
    question: 'Anything else shaping your season of life right now? (Select all that apply)',
    type: 'multi_select',
    options: [
      'Big move / relocating',
      'Recent breakup',
      'Got engaged',
      'Got married',
      'Recently single',
      'Divorce or separation',
      'In a long-term relationship',
      'New parent',
      'Expecting a child',
      'Empty nester',
      'Kids just left for college',
      'Planning a wedding',
      'Planning to have kids',
      'Career change / new job',
      'Just got promoted',
      'Switching industries',
      'Lost job or job searching',
      'Starting a business or side project',
      'Going back to school',
      'Just graduated',
      'Sabbatical or gap time',
      'Just retired',
      'Moved to a new city',
      'First time living alone',
      'Living with roommates again',
      'Dating again after a pause',
      'Recovering from something (health or otherwise)',
      'Caring for a family member',
      'Grief or loss',
      'Navigating a chronic condition',
      'Other',
    ],
  },
  {
    id: 'q12_first_conversation',
    question:
      "Anything else you'd want us to know as we prepare your intros?",
    type: 'open_ended',
    placeholder: 'Optional',
  },
]

export const TOTAL_ONBOARDING_STEPS = PROFILE_STEPS.length + INTAKE_STEPS.length
