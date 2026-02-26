import Link from 'next/link'
import Footer from '../components/Footer'

export const metadata = {
  title: 'Privacy Policy — Fika',
  description: 'How Fika collects, uses, and protects your information.',
}

export default function PrivacyPage() {
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
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: February 2025</p>

        <p>
          We care about your privacy. This policy explains what information we collect, how we use it, and your choices. By using Fika, you agree to this policy.
        </p>

        <h2>Information we collect</h2>
        <p><strong>Account and sign-in.</strong> When you sign up or log in, we collect your phone number. We use it to send you verification codes via SMS each time you sign in, and to identify your account. We do not use email for sign-in.</p>
        <p><strong>Profile.</strong> After sign-up, we collect your name (if you provide it) and any profile details you add—such as photo, bio, interests, and city or region—so we can run the service and personalize your experience.</p>
        <p><strong>Matching.</strong> We use your preferences, who you like or pass, and match status to provide introductions and improve matching.</p>
        <p><strong>In-app messaging.</strong> We store the content of your messages, who you message, and when. We use this to provide messaging and, where needed, for safety and moderation.</p>
        <p><strong>Usage and device.</strong> We collect how you use the app (e.g. screens you view, actions you take), device type, and similar technical data to improve the product and fix issues.</p>
        <p><strong>Safety and reports.</strong> If you report or block someone, we collect and use that information to investigate and enforce our terms.</p>

        <h2>How we use your information</h2>
        <ul>
          <li>To authenticate you and run your account (including sending verification codes via SMS when you sign in)</li>
          <li>To run matching and in-app messaging</li>
          <li>To personalize your experience and introductions</li>
          <li>For safety, fraud prevention, and enforcing our Terms of Service</li>
          <li>To improve the product and analyze usage (in a way that doesn’t identify you where possible)</li>
          <li>To contact you about the service and, with your consent, for marketing</li>
        </ul>

        <h2>SMS and verification codes</h2>
        <p>We send verification codes to your phone number via SMS so you can sign in to Fika. Message and data rates may apply. You can opt out of these messages at any time by replying STOP; reply HELP for help. If you opt out, we will not send further SMS messages to that number, but you will need another way to sign in (e.g. contact us to arrange account access) or create a new account with a different number. We use an SMS provider to deliver these messages; they process your phone number and message delivery on our behalf.</p>

        <h2>Sharing your information</h2>
        <p><strong>With other users.</strong> Your profile and other details you choose to share are visible to people we introduce you to. Message content is visible to the person you’re messaging. We do not share your phone number with other users.</p>
        <p><strong>Service providers.</strong> We use trusted partners for hosting, authentication, SMS delivery, analytics, and similar services. They process data on our behalf under strict agreements.</p>
        <p><strong>Legal and safety.</strong> We may disclose information when required by law or to protect you, other users, or the public.</p>
        <p><strong>Business transfers.</strong> If we sell or merge the company, your information may be transferred as part of that transaction.</p>

        <h2>Data retention</h2>
        <p>We keep your data for as long as your account is active and as needed to provide the service. After you delete your account, we delete or anonymize your data within a reasonable time, except where we must keep it for legal or safety reasons.</p>

        <h2>Your rights</h2>
        <p>You can access, correct, or delete your data through the app or by contacting us. You can export your data and opt out of marketing. You can opt out of SMS by replying STOP to any verification message. If you’re in the EU or UK, you have additional rights, including to object to certain processing and to lodge a complaint with a supervisory authority.</p>

        <h2>Security</h2>
        <p>We use industry-standard measures to protect your data. Sign-in is secured via one-time codes sent to your phone. No system is completely secure; we encourage you to keep your phone secure and be careful with what you share.</p>

        <h2>Children</h2>
        <p>Fika is not for anyone under 18. We don’t knowingly collect data from anyone under 18.</p>

        <h2>International transfers</h2>
        <p>Your data may be processed in the United States or elsewhere. We use appropriate safeguards (such as standard contractual clauses) where required by law.</p>

        <h2>Changes</h2>
        <p>We may update this policy from time to time. We’ll post the new version here and, for material changes, we’ll notify you (e.g. by SMS, in the app, or by other contact details we have).</p>

        <h2>Contact</h2>
        <p>Questions? Contact us at the email or address provided in the app or on our website.</p>
      </main>

      <Footer />
    </>
  )
}
