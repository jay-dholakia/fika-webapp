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
  // for slider: [min, max], default value
  sliderRange?: [number, number]
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
    id: 'pronouns',
    question: "What are your pronouns?",
    type: 'chips_single',
    options: ['He/Him', 'She/Her', 'They/Them', 'Other', 'Prefer not to say'],
  },
  {
    id: 'relationship_status',
    question: "What's your relationship status?",
    type: 'chips_single',
    options: [
      'Single',
      'In a relationship',
      'Married',
      'Divorced',
      'Widowed',
      "It's complicated",
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

// Intake steps (10)
export const INTAKE_STEPS: ProfileStep[] = [
  {
    id: 'q1_conversation_types',
    question:
      'What kind of conversations are you looking for right now? (Choose up to 3.)',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'Light easy conversation',
      'Deeper thoughtful conversation',
      'Big-idea discussions',
      'Slow and reflective',
      'Playful and spontaneous',
      'Professional or builder conversations',
      'Similar season of life',
      'Totally different perspectives',
      'Just seeing what clicks',
    ],
  },
  {
    id: 'q2_week_revolves_around',
    question: 'What does most of your week revolve around? (Choose up to 3.)',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'Work',
      'School',
      'Family',
      'Creative projects',
      'Transitioning',
      'Retired',
      'Caregiving',
      'Community / volunteering',
      'Side projects',
      'Learning / education',
      'Health & wellness',
    ],
  },
  {
    id: 'q3_work_study',
    question:
      'What do you do for work or study? (Optional — a line or two is enough.)',
    type: 'open_ended',
    placeholder: 'A line or two is enough',
  },
  {
    id: 'q5_talk_about',
    question: 'What are some of your interests? (Choose up to 7)',
    type: 'multi_select',
    maxSelections: 7,
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
  {
    id: 'q6_topics',
    question: 'Topics that light you up (Choose up to 5.)',
    type: 'multi_select',
    maxSelections: 5,
    options: [
      'Culture',
      'Relationships',
      'Career',
      'Philosophy',
      'Health',
      'Faith',
      'Parenting',
      'Politics',
      'Meaning / purpose',
      'Other',
    ],
  },
  {
    id: 'q7_age_range',
    question:
      'What age range are you open to having conversations with? (± years from your age)',
    type: 'slider',
    sliderRange: [0, 25],
    sliderDefault: 10,
    sliderLabel: (v) => `± ${v} years`,
  },
  {
    id: 'q8_distance_miles',
    question:
      'How far would you go for a coffee (or similar) to talk? (miles)',
    type: 'slider',
    sliderRange: [0, 50],
    sliderDefault: 15,
    sliderLabel: (v) => `${v} miles`,
  },
  {
    id: 'q9_availability',
    question: 'When are you usually up for a good conversation? (Choose at least 1.)',
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
    id: 'q11_season_of_life',
    question:
      "Anything else shaping your season of life right now? (Optional.)",
    type: 'open_ended',
    placeholder: 'Optional',
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
