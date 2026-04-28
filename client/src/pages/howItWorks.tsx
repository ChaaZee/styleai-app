export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8 fade-up">
      <h1 className="font-display text-3xl sm:text-4xl text-foreground mb-2">How Stitch Works</h1>
      <p className="text-muted-foreground text-sm mb-10">
        Stitch uses AI to analyse your outfit and help you shop smarter.
      </p>

      {/* Step 1 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-primary font-bold text-sm">1</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Upload a photo</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed pl-11">
          Take or upload any photo of an outfit — yours, an influencer's, a screenshot from social media,
          or something you spotted on the street. Stitch accepts JPEG, PNG, and WebP images.
        </p>
      </div>

      {/* Step 2 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-primary font-bold text-sm">2</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">AI style analysis</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed pl-11">
          Stitch runs the image through a two-pass AI vision model (Google Gemini) that identifies every
          garment and accessory in the photo, detects colours and patterns, and classifies the overall
          aesthetic — from streetwear and old money to cottagecore and dark academia. The analysis
          typically completes in under 10 seconds.
        </p>
      </div>

      {/* Step 3 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-primary font-bold text-sm">3</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Get shoppable recommendations</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed pl-11">
          You receive two sets of product recommendations: <strong className="text-foreground">Get the Look</strong> — exact
          pieces that replicate what's in the outfit — and <strong className="text-foreground">Complete the Look</strong> — stylist-curated
          additions that complement the aesthetic. Every recommendation links directly to a product on Amazon
          so you can shop immediately.
        </p>
      </div>

      {/* Step 4 */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-primary font-bold text-sm">4</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Discover & save your style</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed pl-11">
          Browse the Discover feed for curated outfit inspiration across every aesthetic. Heart looks
          you love to save them. Your scan history is saved automatically so you can revisit past
          analyses anytime.
        </p>
      </div>

      {/* Colour palette section */}
      <div className="rounded-xl border border-border bg-card p-5 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-2">Colour palette detection</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every analysis extracts a 4–5 colour palette directly from your photo. These swatches represent
          the dominant hues in the outfit and help you understand the colour story behind the look —
          useful for building a cohesive wardrobe over time.
        </p>
      </div>

      {/* Aesthetics section */}
      <div className="rounded-xl border border-border bg-card p-5 mb-10">
        <h2 className="text-base font-semibold text-foreground mb-3">Aesthetics Stitch recognises</h2>
        <div className="flex flex-wrap gap-2">
          {["Streetwear","Old Money","Clean Girl","Cottagecore","Dark Academia","Minimalist",
            "Y2K","Coastal","Boho","Athleisure","Romantic","Preppy","Indie","Business Casual",
            "Hypebeast"].map(a => (
            <span key={a} className="text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground font-medium">
              {a}
            </span>
          ))}
        </div>
      </div>

      {/* Amazon shop CTA */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <h2 className="text-base font-semibold text-foreground mb-1">Shop fashion on Amazon</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Browse thousands of clothing, shoes, and accessories on Amazon — all available with fast shipping.
        </p>
        <a
          href="https://www.amazon.com/s?k=fashion+clothing&tag=styleaiapp-20"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Shop Fashion on Amazon
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        Stitch is an Amazon Associates participant. We earn a small commission on qualifying purchases at no extra cost to you.
      </p>
    </div>
  );
}
