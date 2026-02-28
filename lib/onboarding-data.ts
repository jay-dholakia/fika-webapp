// LA Beta onboarding: Profile + Intake. No availability, work/study, political, open-ended.
// Types: text | date | chips_single | location_permission | multi_select

export type StepType =
  | 'text'
  | 'date'
  | 'chips_single'
  | 'location_permission'
  | 'multi_select'

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
}

// LA Beta PROFILE (6 steps)
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
  },
  {
    id: 'gender',
    question: "What's your gender?",
    type: 'chips_single',
    required: true,
    options: ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'],
  },
  {
    id: 'gender_preference',
    question: "Do you have a gender preference for who you'd like to meet?",
    type: 'chips_single',
    required: true,
    options: ['No preference', 'Same gender', 'Different gender'],
  },
  {
    id: 'languages',
    question: 'What languages do you speak?',
    body: 'Select all that apply.',
    type: 'multi_select',
    required: true,
    options: [
      'English',
      'Spanish',
      'Korean',
      'Mandarin',
      'Japanese',
      'Armenian',
      'Tagalog',
      'Persian',
      'Other',
      'Prefer not to say',
    ],
  },
  {
    id: 'location',
    question: 'Where are you located?',
    body: 'Your location is private and only used for matching.',
    type: 'location_permission',
    required: true,
  },
]

// LA Beta INTAKE (8 steps): life chapter, lately, everyday anchor, topics, convo feel, openness, radius, confirm
export const INTAKE_STEPS: ProfileStep[] = [
  {
    id: 'q_life_chapter',
    question: 'What chapter are you in right now?',
    body: 'Choose up to 3.',
    type: 'multi_select',
    maxSelections: 3,
    required: true,
    options: [
      "Exploring what's next",
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
    id: 'q_lately',
    question: "Lately, I've been thinking a lot about…",
    body: 'Choose up to 3.',
    type: 'multi_select',
    maxSelections: 3,
    options: [
      'My career direction',
      'A big life decision',
      'Relationships & connection',
      'My health & well-being',
      'Purpose & meaning',
      'Financial stability',
      'Creativity or a personal project',
      'Where I want to live',
      'The state of the world',
      'Nothing heavy — just enjoying life',
    ],
  },
  {
    id: 'q_everyday_anchor',
    question: "What's something that plays a meaningful role in your everyday life?",
    body: 'Select up to 2.',
    type: 'multi_select',
    maxSelections: 2,
    options: [
      'A pet or animals',
      'Family responsibilities',
      'A romantic relationship',
      'Close friendships',
      'A creative pursuit',
      'My career or business',
      'Faith or spiritual practice',
      'A fitness routine or sport',
      'Volunteering or service',
      'A personal project I care deeply about',
      'Travel or exploration',
      'None of the above / Prefer not to say',
    ],
  },
  {
    id: 'q_topics',
    question: 'Which topics do you genuinely enjoy discussing?',
    body: 'Choose up to 5.',
    type: 'multi_select',
    maxSelections: 5,
    required: true,
    options: [
      'Philosophy & big questions',
      'Psychology & human behavior',
      'Technology & innovation',
      'Science discoveries',
      'Culture shifts & generational trends',
      'Current events & global affairs',
      'Travel & different cultures',
      'Food & restaurants',
      'Career journeys',
      'Entrepreneurship & building things',
      'Film & television',
      'Books & storytelling',
      'Music',
      'Visual art & design',
      'Relationships & modern dating',
      'Mental health & emotional growth',
      'Religion & spirituality',
      'Community & civic life',
    ],
  },
  {
    id: 'q_convo_feel',
    question: 'How do you like a first conversation to feel?',
    body: 'Choose up to 3.',
    type: 'multi_select',
    maxSelections: 3,
    required: true,
    options: [
      'Light and easy',
      'Thoughtful and reflective',
      'Curious and exploratory',
      'Deep dive into one topic',
      'A mix — see where it goes',
    ],
  },
  {
    id: 'q_openness',
    question: 'Who would you be open to meet for a Fika?',
    body: 'Choose up to 2.',
    type: 'multi_select',
    maxSelections: 2,
    required: true,
    options: [
      "Someone I'd instantly relate to",
      'Someone outside my usual bubble',
      'Someone navigating a big life change',
      'Someone whose perspective challenges mine',
      "I'm open to anyone",
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
    id: 'confirm_intent',
    question: 'Fika is built for thoughtful, platonic connection.',
    body: "We're here to help people meet others nearby for real conversation. Any behavior that doesn't align may result in removal.",
    type: 'chips_single',
    required: true,
    options: ["I'm in"],
  },
]

export const TOTAL_ONBOARDING_STEPS = PROFILE_STEPS.length + INTAKE_STEPS.length
