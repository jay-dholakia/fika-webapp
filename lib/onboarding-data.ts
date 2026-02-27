// Profile steps (5) then intake steps; confirm_intent is the last intake step.
// Types: text | date | chips_single | location_permission | multi_select | slider | open_ended | searchable_single | single_select

import { INDUSTRY_OPTIONS } from './industry-options'
import { LA_COLLEGES } from './la-colleges'
import { MAJORS } from './majors'

export type StepType =
  | 'text'
  | 'date'
  | 'chips_single'
  | 'location_permission'
  | 'multi_select'
  | 'slider'
  | 'open_ended'
  | 'searchable_single'
  | 'single_select'

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

// Profile steps 1–5 (no confirm_intent here; it's at end of intake)
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
    options: ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'],
  },
  {
    id: 'pronouns',
    question: 'What are your pronouns? (Optional)',
    type: 'chips_single',
    options: ['She/Her', 'He/Him', 'They/Them', 'Other', 'Prefer not to say'],
  },
  {
    id: 'gender_preference',
    question: 'Do you have a gender preference for who you\'d like to meet?',
    type: 'chips_single',
    options: [
      'No preference',
      'Same gender',
      'Different gender',
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
      'Turkish',
      'Other',
      'Prefer not to say',
    ],
  },
  {
    id: 'location',
    question: 'Where are you located?',
    body: 'Share your location to get intros to people nearby.\n\nYour location is private and will not be shared with anyone.',
    type: 'location_permission',
    required: true,
  },
]

// Intake steps — ordered: who you are → how you connect → who you're open to → practicals → optional wrap
export const INTAKE_STEPS: ProfileStep[] = [
  // Who you are / where you're at
  {
    id: 'q2_life_chapter',
    question: 'What life chapter are you in right now? (Choose up to 4)',
    body: 'Choose the ones that feel closest:',
    type: 'multi_select',
    maxSelections: 4,
    options: [
      'Exploring what\'s next',
      'Early in my career',
      'Growing professionally',
      'Building something meaningful',
      'Feeling grounded and steady',
      'Raising a family',
      'Establishing roots in a new city',
      'Starting over / reinventing',
      'Supporting family members',
      'Mentoring and giving back',
    ],
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
      'Dancing',
      'Art',
      'Photography',
      'Design',
      'Creativity',
      'Cooking',
      'Food',
      'Dining out',
      'Film & TV',
      'Comedy',
      'Theater',
      'Podcasts',
      'Baseball',
      'Basketball',
      'Football',
      'Golf',
      'Hockey',
      'Pickleball',
      'Skiing',
      'Snowboarding',
      'Soccer',
      'Tennis',
      'Volleyball',
      'Board games',
      'Trivia',
      'Tech',
      'Building things',
      'Entrepreneurship',
      'Work',
      'Travel',
      'Gardening',
      'Volunteering',
      'Community',
      'Current events',
      'Dogs',
      'Cats',
    ],
  },
  {
    id: 'q3_work_or_study',
    question: 'What best describes you right now?',
    type: 'chips_single',
    options: [
      'I work',
      "I'm in school",
      'I work and study',
      'Between things / in transition',
      'On extended leave',
      'Other',
      'Prefer not to say',
    ],
  },
  {
    id: 'q3_profession',
    question: 'What industry are you in?',
    body: 'Choose the one that best fits your work.',
    type: 'single_select',
    placeholder: 'Choose industry…',
    options: INDUSTRY_OPTIONS,
  },
  {
    id: 'q3_university',
    question: 'What college or university do you go to?',
    body: 'Colleges and universities in the Greater Los Angeles area.',
    type: 'searchable_single',
    placeholder: 'Search schools…',
    options: LA_COLLEGES,
  },
  {
    id: 'q3_major',
    question: "What's your major?",
    type: 'searchable_single',
    placeholder: 'Search majors…',
    options: MAJORS,
  },
  // How you like to connect
  {
    id: 'q1_conversation_types',
    question:
      'What kind of conversations are you craving more of lately? (Choose up to 4)',
    type: 'multi_select',
    maxSelections: 4,
    options: [
      'Work, career, and ambition',
      'Creativity, side projects, and ideas',
      'Deep or philosophical (life, meaning, big questions)',
      'Light and fun (humor, stories, banter)',
      "What's happening in the world (news, culture, society)",
      'Hobbies and shared interests',
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
      "Someone I'd instantly relate to",
      'Someone with a very different background than mine',
      'Someone outside my usual bubble',
      'Someone navigating a big life change',
      'Someone whose perspective challenges mine',
      "I'm open to anyone",
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
      'Big move or relocating',
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
      'Career change or new job',
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
    body: 'Anything else on your mind, topics to avoid, etc.',
    type: 'open_ended',
    placeholder: 'Optional',
  },
  {
    id: 'confirm_intent',
    question: 'Fika is built for thoughtful, platonic connection.',
    body: "We're here to help people meet others nearby for real conversation, shared interests, and meaningful experiences — clearly and respectfully.\n\nAny behavior that doesn't align with this may result in removal from our platform.",
    type: 'chips_single',
    options: ["I'm in"],
    required: true,
  },
]

export const TOTAL_ONBOARDING_STEPS = PROFILE_STEPS.length + INTAKE_STEPS.length
