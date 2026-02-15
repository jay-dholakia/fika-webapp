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
              Real people.<br />
              <span className="hero-title-accent">Real conversation.</span>
            </h1>
            <p className="hero-sub">
              Meet people in person for real conversation—based on what you share and what you don’t. You choose who to meet. Coffee, a walk, or a bench.
            </p>
            <a href="#cta" className="btn btn-primary">Join the waitlist</a>
          </div>
          <div className="hero-blob" aria-hidden />
        </section>

        <section id="what" className="section section-what">
          <div className="section-inner">
            <h2 className="section-title section-headword">Fika</h2>
            <p className="section-pos"><em>noun</em></p>
            <p className="section-body">
              <span className="section-def-num">1.</span> In Swedish, a break with someone—coffee, something sweet, and real conversation. No agenda. Just connection.<br />
              <span className="section-def-num">2.</span> The platform we built to bring that idea back. No swiping, no friend list. Each week you get a handful of intros—people we think you’ll click with, based on what you share and what you don’t. You choose who you’d like to meet. In person, the conversation actually goes somewhere. After that, you can stay in touch or leave it at one great fika. Your call.
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
                <h3 className="step-title">Get your weekly intros</h3>
                <p className="step-text">We send you a few intros each week. You pick who you’d like to meet.</p>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <h3 className="step-title">Opt in and meet in real life</h3>
                <p className="step-text">Say yes and meet in person—coffee, a walk, or a spot that works.</p>
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
                <p className="benefit-text">Conversations happen face to face. Real-life fikas—no DMs that fizzle.</p>
              </li>
              <li className="benefit">
                <span className="benefit-icon">↔️</span>
                <h3 className="benefit-title">Similarities & differences</h3>
                <p className="benefit-text">We match on what you share and what you don’t, so there’s something to talk about—and something to learn.</p>
              </li>
              <li className="benefit">
                <span className="benefit-icon">🎯</span>
                <h3 className="benefit-title">Curated, not endless</h3>
                <p className="benefit-text">No swiping, no endless feed. You get a small set of intros each week and choose who to meet. Quality over quantity.</p>
              </li>
            </ul>
          </div>
        </section>

        <section id="cta" className="section section-cta">
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Ready for a real fika?</h2>
            <p className="cta-sub">We’re opening up soon. Leave your email and we’ll tell you when you can get your first weekly intros.</p>
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
