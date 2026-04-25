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
        <p className="legal-updated">Last updated: March 2025</p>

        <p>
          We care about your privacy. This policy explains what information we collect, how we use it, and your choices. By using Fika, you agree to this policy.
        </p>

        <h2>Information we collect</h2>
        <p><strong>Account and sign-in.</strong> You sign in to Fika via our website using Google or another method we offer. We collect your phone number separately so we can send SMS introductions, proposed times and places, scheduling updates, and meetup details. We do not use your phone number for sign-in verification.</p>
        <p><strong>Profile.</strong> We collect your name (if you provide it) and any profile details you add—such as photo, bio, interests, when you’re usually free for a Fika, and city or region—so we can run the service and personalize your experience. You set your profile on our web portal.</p>
        <p><strong>Intros.</strong> We use your profile and preferences to find good Fika intros. When relevant, we use your SMS replies (e.g. accept/pass, Yes or No to a proposed time and place), your scheduling responses, and intro status to provide introductions and improve who we suggest.</p>
        <p><strong>SMS with Fika.</strong> We store the content of your SMS conversations with Fika (e.g. intro responses and scheduling replies) and use it to run the service, send you intros and meetup details, and for safety and support where needed.</p>
        <p><strong>Messaging after an intro.</strong> If we offer a chat or messaging channel with people we introduce you to, we store that message content, who you message, and when, and use it to provide the feature and for safety and moderation.</p>
        <p><strong>Usage and device.</strong> We collect how you use the service (e.g. pages you view, actions you take on the web portal and in response to SMS), device type, and similar technical data to improve the product and fix issues.</p>
        <p><strong>Safety and reports.</strong> If you report or block someone, we collect and use that information to investigate and enforce our terms.</p>

        <h2>How we use your information</h2>
        <ul>
          <li>To authenticate you and run your account (sign-in to the web portal via Google or another method we offer)</li>
          <li>To run SMS introductions, scheduling (including proposed times and places), and meetup coordination—and to communicate with you via SMS for intros and coordination</li>
          <li>To line up intros and any messaging we offer with someone you met through Fika</li>
          <li>To personalize your experience and introductions</li>
          <li>For safety, fraud prevention, and enforcing our Terms of Service</li>
          <li>To improve the product and analyze usage (in a way that doesn’t identify you where possible)</li>
          <li>To contact you about the service and, with your consent, for marketing</li>
        </ul>

        <h2>SMS</h2>
        <p>We use SMS to deliver the Fika experience: introductions, proposed times and places when we find a good Fika intro for you, scheduling confirmations, day-of reminders, and follow-ups. Message and data rates may apply. You can opt out of these messages at any time by replying STOP; reply HELP for help. If you opt out, we will not send further SMS messages to that number. You can still sign in to the web portal and manage your account (including deleting it); you will not receive intros or coordination via SMS until you opt back in. We use an SMS provider to deliver these messages; they process your phone number and message delivery on our behalf. We store and process the content of your SMS conversations to provide the service and as described in this policy.</p>

        <h2>Sharing your information</h2>
        <p><strong>With other users.</strong> Your profile and other details you choose to share are visible to people we introduce you to. We do not share your phone number or the content of your SMS conversations with other users. If we offer messaging after an intro, that message content is visible to the person you’re messaging.</p>
        <p><strong>Service providers.</strong> We use trusted partners for hosting, authentication, SMS delivery, analytics, and similar services. They process data on our behalf under strict agreements.</p>
        <p><strong>Legal and safety.</strong> We may disclose information when required by law or to protect you, other users, or the public.</p>
        <p><strong>Business transfers.</strong> If we sell or merge the company, your information may be transferred as part of that transaction.</p>

        <h2>Data retention</h2>
        <p>We keep your data for as long as your account is active and as needed to provide the service. After you delete your account, we delete or anonymize your data within a reasonable time, except where we must keep it for legal or safety reasons.</p>

        <h2>Your rights</h2>
        <p>You can access, correct, or delete your data through the web portal or by contacting us. You can export your data and opt out of marketing. You can opt out of SMS by replying STOP to any Fika message (see the SMS section above). After you opt out, you can still sign in and manage your account on the web. If you’re in the EU or UK, you have additional rights, including to object to certain processing and to lodge a complaint with a supervisory authority.</p>

        <h2>Security</h2>
        <p>We use industry-standard measures to protect your data. Sign-in to the web portal is secured via Google or another method we offer. Your phone number is used for the Fika SMS experience and is protected by our security measures and our agreements with the SMS provider. No system is completely secure; we encourage you to keep your credentials and phone secure and be careful with what you share.</p>

        <h2>Children</h2>
        <p>Fika is not for anyone under 18. We don’t knowingly collect data from anyone under 18.</p>

        <h2>International transfers</h2>
        <p>Your data may be processed in the United States or elsewhere. We use appropriate safeguards (such as standard contractual clauses) where required by law.</p>

        <h2>Changes</h2>
        <p>We may update this policy from time to time. We’ll post the new version here and, for material changes, we’ll notify you (e.g. by SMS, on the web portal, or by other contact details we have).</p>

        <h2>Contact</h2>
        <p>Questions? Contact us at the email or address provided on our website.</p>
      </main>

      <Footer />
    </>
  )
}
