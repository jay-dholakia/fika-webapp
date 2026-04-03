// LA Beta onboarding: Profile + Intake (Final). No maxes on multi_select.
// Types: text | date | chips_single | location_permission | multi_select | searchable_multi | searchable_single | select

import { COUNTRY_NAMES_FOR_SELECT } from '@/lib/countries-list'
import collegeNames from '@/lib/data/colleges.json'
import musicArtistNames from '@/lib/data/music-artists.json'
import podcastTitles from '@/lib/data/podcasts.json'
import sportsTeamNames from '@/lib/data/sports-teams.json'
import tvStreamingTitles from '@/lib/data/tv-streaming-shows.json'
import { ETHNICITY_OPTIONS } from '@/lib/ethnicity-options'
import { RELATIONSHIP_STATUS_OPTIONS } from '@/lib/relationship-status-options'
import { US_STATE_NAMES } from '@/lib/us-states-list'
import { WORK_ROLE_FEATURED, WORK_ROLE_OPTIONS } from '@/lib/work-role-options'

export type StepType =
  | 'text'
  | 'date'
  | 'chips_single'
  | 'location_permission'
  | 'multi_select'
  | 'searchable_multi'
  | 'searchable_single'
  | 'select'

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
}

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
    placeholder: 'MM/DD/YYYY',
  },
  {
    id: 'gender',
    question: "What's your gender?",
    type: 'chips_single',
    required: true,
    options: ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'],
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

// INTAKE (Final): Block 1 Life context → Block 2 Interests → Block 3 Topics → Block 4 Perspective → Block 5 Matching.
// Block 1: background (roots) → life chapter → everyday anchor → work.
// Block 2: interests → curiosity.
export const INTAKE_STEPS: ProfileStep[] = [
  // Block 1 — Background: where you're from — not current location
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
    id: 'q_hometown',
    question: 'Hometown',
    body: 'City or region you grew up in.',
    type: 'text',
    required: false,
    placeholder: 'e.g. Columbus, Ohio',
  },
  {
    id: 'q_college',
    question: 'Where did you go to school? (optional)',
    type: 'searchable_single',
    required: false,
    customAnswerMaxLength: 100,
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
  // Block 1 — Life context: stage → daily reality
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
    id: 'q_work',
    question: 'What do you do for work?',
    body: "Pick the closest match from the list, or type your own.\n\nIf you're not in paid work right now, that's welcome too: unemployed, between jobs, stay-at-home parent, full-time caregiving at home, a career break, sabbatical, in school, retired—or anything that fits you.",
    type: 'searchable_single',
    required: false,
    featuredOptions: WORK_ROLE_FEATURED,
    options: [...WORK_ROLE_OPTIONS],
    customAnswerMaxLength: 100,
    placeholder: 'Type to search roles or enter your own',
  },
  // Block 2 — Interests: interests → curiosity → recs
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
    question: 'Shows you’re into',
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
    question: 'Musical artists or bands you’re into',
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
      'Stuff we’re into lately (books, shows, podcasts, games)',
      'Recent travel and places you’ve visited',
      'What we’re working on (work or projects)',
      'Giving/getting advice for professional & personal growth',
      'Life in our city (neighborhoods, restaurants, hangout spots)',
      'Big questions and how we see the world',
      'Hobbies and things we’d like to try next',
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
  // Matching preferences
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
    id: 'age_preference',
    question: "Do you have an age preference for who you'd like to meet?",
    type: 'chips_single',
    required: true,
    options: ['Open to any age/life stage', 'Prefer around my age'],
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

export const TOTAL_ONBOARDING_STEPS = PROFILE_STEPS.length + INTAKE_STEPS.length
