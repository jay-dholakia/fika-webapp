import Link from 'next/link'
import Footer from '../components/Footer'

export const metadata = {
  title: 'Terms of Service — Fika',
  description: 'Terms of use for the Fika app and website.',
}

export default function TermsPage() {
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">
            fika
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/">Home</Link>
          </nav>
        </div>
      </header>

      <main className="legal-page">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: February 2025</p>

        <p>
          Welcome to Fika. By using our app or website, you agree to these terms. Please read them carefully.
        </p>

        <h2>Eligibility</h2>
        <p>You must be at least 18 years old and able to form a binding contract to use Fika. By using the service, you represent that you meet these requirements.</p>

        <h2>Your account</h2>
        <p>You must provide accurate, current information and keep it up to date. One account per person. You’re responsible for everything that happens on your account. Keep your password secure.</p>

        <h2>Acceptable use</h2>
        <p>You agree to use Fika in a respectful, lawful way. You will not:</p>
        <ul>
          <li>Harass, bully, threaten, or abuse anyone</li>
          <li>Post hateful, violent, or illegal content</li>
          <li>Impersonate someone else or create fake profiles</li>
          <li>Use the service for spam, solicitation, or commercial purposes (unless we allow it)</li>
          <li>Misuse other people’s data or our systems</li>
        </ul>
        <p>This applies to your profile, in-app messages, and any other use of the service. We may remove content or suspend or terminate accounts that violate these rules.</p>

        <h2>The service</h2>
        <p>Fika provides introductions and in-app messaging to help you meet people in real life. We don’t guarantee matches or any particular outcome. The service is provided “as is” to the extent permitted by law.</p>

        <h2>In-app messaging</h2>
        <p>Messaging is for genuine, respectful conversation. Don’t send harassing, illegal, or otherwise prohibited content. We may review messages for safety and to enforce these terms. Message content may be retained as described in our <Link href="/privacy">Privacy Policy</Link>.</p>

        <h2>Meeting in person &amp; safety</h2>
        <p>When you meet someone from Fika in person, you do so at your own risk. We encourage you to <strong>meet in public, well-lit places</strong> (e.g. a café or park) and to tell a friend where you’re going. You are responsible for your own safety. We are not responsible for what happens during in-person meetings.</p>
        <p>You can report or block users in the app. We may take action based on reports, but we don’t guarantee any particular outcome. We may use technology and human review to help keep the community safe.</p>

        <h2>Your content</h2>
        <p>You keep ownership of the content you post. You give us a license to use, display, and store it as needed to run the service (e.g. showing your profile to matches, storing messages).</p>

        <h2>Our intellectual property</h2>
        <p>Fika’s name, logo, design, and the service itself are owned by us. You may not copy or use them without our permission.</p>

        <h2>Disclaimers</h2>
        <p>To the fullest extent permitted by law, we disclaim all warranties (express or implied). We don’t guarantee that the service will be uninterrupted, error-free, or secure.</p>

        <h2>Limitation of liability</h2>
        <p>To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, or consequential damages, or for any loss of data, profits, or goodwill. Our total liability is limited to the amount you paid us in the past 12 months (or $100 if you paid nothing).</p>

        <h2>Indemnification</h2>
        <p>You agree to indemnify and hold Fika and its affiliates harmless from any claims, damages, or costs arising from your use of the service or your violation of these terms.</p>

        <h2>Termination</h2>
        <p>We may suspend or terminate your account at any time for breach of these terms or for any other reason. You may delete your account at any time. When your account is terminated, your right to use the service ends. We may retain data as described in our Privacy Policy.</p>

        <h2>Disputes</h2>
        <p>These terms are governed by the laws of the State of Delaware (or the state/country specified in the app for your region). Any dispute will be resolved in the courts of that jurisdiction, or by binding arbitration if we agree to it.</p>

        <h2>Changes</h2>
        <p>We may change these terms from time to time. We’ll post the new version here and notify you of material changes. Continued use of the service after changes means you accept the new terms.</p>

        <h2>Contact</h2>
        <p>Questions about these terms? Contact us at the email or address provided in the app or on our website.</p>
      </main>

      <Footer />
    </>
  )
}
