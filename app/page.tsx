export default function Home() {
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a href="/" className="logo">Fika</a>
          <nav className="nav">
            <a href="#what">What is Fika</a>
            <a href="#how">How it works</a>
            <a href="#cta" className="nav-cta">Get notified</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-inner">
            <p className="hero-label">In-person connection, the way it used to be</p>
            <h1 className="hero-title">
              One person.<br />
              One conversation.<br />
              <span className="hero-title-accent">No algorithm feed.</span>
            </h1>
            <p className="hero-sub">
              Fika matches you with someone for a single, real-life meetup—based on what you have in common and what you don’t. Coffee, walk, or a bench. Just the two of you.
            </p>
            <a href="#cta" className="btn btn-primary">Join the waitlist</a>
          </div>
          <div className="hero-blob" aria-hidden />
        </section>

        <section id="what" className="section section-what">
          <div className="section-inner">
            <h2 className="section-title">What is Fika?</h2>
            <p className="section-lead">
              In Sweden, <em>fika</em> means taking a break with someone—coffee, something sweet, and real talk. No agenda. Just connection.
            </p>
            <p className="section-body">
              We built Fika to bring that idea back. You’re not swiping. You’re not building a friend list. You get matched with <strong>one person</strong> for <strong>one in-person conversation</strong>. We use what you share—and what you don’t—so the conversation actually goes somewhere. After that, you can stay in touch or leave it at one great fika. Your call.
            </p>
          </div>
        </section>

        <section id="how" className="section section-how">
          <div className="section-inner">
            <h2 className="section-title">How it works</h2>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <h3 className="step-title">Share a bit about you</h3>
                <p className="step-text">Quick questions about what you care about, how you spend your time, and what kind of conversation you’re looking for.</p>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <h3 className="step-title">Get one match</h3>
                <p className="step-text">We introduce you to one person—aligned enough to click, different enough to make it interesting. No endless feed.</p>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <h3 className="step-title">Meet in real life</h3>
                <p className="step-text">Grab coffee, take a walk, or find a spot. One conversation, in person. That’s the whole point.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section section-why">
          <div className="section-inner">
            <h2 className="section-title">Why Fika?</h2>
            <ul className="benefits">
              <li className="benefit">
                <span className="benefit-icon">☕</span>
                <h3 className="benefit-title">Real, not virtual</h3>
                <p className="benefit-text">Conversations happen face to face. One person, one fika—no DMs that fizzle.</p>
              </li>
              <li className="benefit">
                <span className="benefit-icon">↔️</span>
                <h3 className="benefit-title">Similarities & differences</h3>
                <p className="benefit-text">We match on what you share and what you don’t, so there’s something to talk about—and something to learn.</p>
              </li>
              <li className="benefit">
                <span className="benefit-icon">🎯</span>
                <h3 className="benefit-title">One at a time</h3>
                <p className="benefit-text">No swiping, no queue. You get one match, one conversation. Quality over quantity.</p>
              </li>
            </ul>
          </div>
        </section>

        <section id="cta" className="section section-cta">
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Ready for a real fika?</h2>
            <p className="cta-sub">We’re opening up soon. Leave your email and we’ll tell you when you can get your first match.</p>
            <form className="cta-form" action="#" method="post">
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                className="cta-input"
                required
              />
              <button type="submit" className="btn btn-primary btn-block">Notify me</button>
            </form>
            <p className="cta-note">No spam. Just one email when we launch.</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span className="logo">Fika</span>
          <p className="footer-tagline">Real connection, one conversation at a time.</p>
        </div>
      </footer>
    </>
  )
}
