import { Faq } from "@/components/faq";

const APPLY_URL = "https://calendly.com/chriswestt/rawgrowth-discovery";

const oldWay = [
  "CMO or marketing director — $150–250K/yr and still can't keep up",
  "Agencies charging $10–20K/mo with recycled strategies",
  "Bloated teams eating margins — payroll keeps growing",
  "3–6 months to hire and ramp, training costs stack up",
  "Best talent leaves for higher salaries",
  "Manual reporting across disconnected tools",
];

const newWay = [
  "AI content engine — 60+ pieces/week in your voice",
  "AI sales system — lead scoring, follow-up, booking 24/7",
  "AI agents handling ops, reporting, coordination",
  "Real-time dashboard — every metric, one screen",
  "Does the work of 3–5 hires. Installed in 7 days.",
  "Never leaves, never asks for a raise, compounds monthly.",
];

const phases = [
  {
    tag: "Discovery",
    when: "Week 1–2",
    title: "Comprehensive Business Audit",
    body:
      "We go through your entire operation, what each team member is ACTUALLY working on, and how AI is going to enhance that.",
    bullets: [
      "Map all existing tools & systems",
      "Identify revenue bottlenecks",
      "Score AI-readiness per department",
      "Deliver prioritized install roadmap",
    ],
    visual: "audit" as const,
  },
  {
    tag: "Foundation",
    when: "Week 2–4",
    title: "Your Company Database",
    body:
      "We connect every tool you use and build a single source of truth. Contacts, deals, conversations, tasks, payments — all indexed, all searchable. Your AI agents need context. This is how they get it.",
    bullets: [
      "Connect all existing tools & APIs",
      "Sync contacts, deals, conversations & files",
      "Build unified data model across departments",
      "Real-time sync — always current, never stale",
    ],
    visual: "database" as const,
  },
  {
    tag: "Activation",
    when: "Week 4–8",
    title: "Deploy Trained AI Talent",
    body:
      "Custom local agents trained on your company data and daily workflow. They follow up with leads, schedule meetings, script content, generate ad creatives, track your pipeline, see your prospects' biggest problems. All feeding into each other. The best part? They don't sleep, eat, complain, or churn.",
    bullets: [
      "Deploy agents across sales, content & ops",
      "Real-time dashboard with full visibility",
      "Agents act on your data — not templates",
      "Escalation protocols for edge cases",
    ],
    visual: "board" as const,
  },
  {
    tag: "Intelligence",
    when: "Week 8–12",
    title: "Your Company LLM",
    body:
      "A custom private LLM trained purely on your company. Every employee gets a login. It knows your SOPs, your clients, your sales calls, your marketing, your team. Ask it anything. Spin up agents to go execute. It's your entire company's brain, accessible from one chat window. Your data is securely siloed — never used to train public models, never shared, never exposed. Enterprise-grade permissions as standard.",
    bullets: [
      "Private LLM trained on your company data",
      "Employee logins with role-based access",
      "Spin up task agents from the chat",
      "Knows every SOP, client & metric",
      "Data never used to train public models",
      "SOC2 & GDPR compliant by default",
    ],
    visual: "chat" as const,
  },
];

const results = [
  {
    company: "Sales Automation Systems",
    metric: "$62K → $236K/mo",
    body:
      "Scaled revenue 280% in 12 weeks. Team went from 7 to 1 operator. Founder works 3 hours a day.",
  },
  {
    company: "RemotelyX",
    metric: "106 hrs saved / week",
    body:
      "Eliminated 106 hours of manual work in 14 days. Headcount dropped from 14 to 8. Profit margin nearly doubled.",
  },
  {
    company: "Above Aerosol",
    metric: "$55K/yr SDR → $0",
    body:
      "Replaced a full-time SDR with an AI agent. Response time went from 4.2 hours to under 2 minutes. Booked calls jumped 161%.",
  },
  {
    company: "Inovate",
    metric: "20 SDRs → 1 AI agent",
    body:
      "Cut $180K/mo in payroll to $12K/mo. Meetings booked went up 50%. Cost per meeting dropped from $1,285 to $57.",
  },
];

const brands = [
  "Starbucks",
  "Nike",
  "McKinsey & Co",
  "Terminix",
  "Sales Automation Systems",
  "JD Sports",
  "RemotelyX",
  "Above Aerosol",
  "Inovate",
  "Serrania",
];

export default function Home() {
  return (
    <div className="relative w-full overflow-hidden">
      <BackgroundGlow />
      <Header />
      <main>
        <Hero />
        <LogoBar />
        <div className="mx-auto divider-fade max-w-[500px] xl:max-w-[600px]" />
        <Shift />
        <Services />
        <Results />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[-1] h-full overflow-hidden">
      <div
        className="dot-grid absolute inset-0"
        style={{
          maskImage:
            "radial-gradient(ellipse 80% 50% at 50% 0%, black 10%, transparent 60%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 50% at 50% 0%, black 10%, transparent 60%)",
        }}
      />
      <div className="absolute -top-[200px] left-1/2 h-[1000px] w-[1200px] -translate-x-1/2 bg-[radial-gradient(circle,rgba(12,191,106,.07)_0%,transparent_60%)]" />
      <div className="absolute left-[-10%] top-[35%] h-[800px] w-[600px] bg-[radial-gradient(ellipse,rgba(12,191,106,.04)_0%,transparent_70%)]" />
      <div className="absolute right-[-10%] top-[30%] h-[600px] w-[500px] bg-[radial-gradient(ellipse,rgba(12,191,106,.03)_0%,transparent_70%)]" />
      <div className="absolute left-1/2 top-[55%] h-[800px] w-[1000px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(12,191,106,.035)_0%,transparent_65%)]" />
      <div className="absolute bottom-[5%] left-1/2 h-[600px] w-[800px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(12,191,106,.05)_0%,transparent_65%)]" />
      <div className="absolute bottom-[-5%] right-[10%] h-[400px] w-[400px] bg-[radial-gradient(circle,rgba(12,191,106,.03)_0%,transparent_70%)]" />
    </div>
  );
}

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full border-b border-[rgba(12,191,106,.15)] bg-[rgba(6,11,8,.8)] backdrop-blur-2xl">
      <nav className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-4 md:px-10 lg:px-16">
        <a href="#" className="flex-shrink-0">
          <span className="font-serif text-2xl tracking-tight text-white">
            rawgrowth<span className="text-primary">.</span>
          </span>
        </a>
        <div className="hidden items-center gap-1 md:flex lg:gap-2">
          <a
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-[rgba(255,255,255,.75)] transition-colors hover:bg-white/5 hover:text-white"
            href="#services"
          >
            Services
          </a>
          <a
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-[rgba(255,255,255,.75)] transition-colors hover:bg-white/5 hover:text-white"
            href="#"
          >
            About Us
          </a>
          <a
            href={APPLY_URL}
            className="btn-shine ml-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Get Started
          </a>
        </div>
      </nav>
    </header>
  );
}

function PrimaryCta({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={APPLY_URL}
      className="btn-shine inline-flex items-center gap-2.5 rounded-xl bg-primary px-10 py-4 text-[15px] font-bold text-white transition-transform duration-300 hover:-translate-y-0.5 xl:px-12 xl:py-5 xl:text-[17px]"
    >
      {children}
    </a>
  );
}

function SectionTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[rgba(10,148,82,.2)] bg-[rgba(12,191,106,.08)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[1.5px] text-primary xl:px-5 xl:py-2 xl:text-sm">
      {children}
    </span>
  );
}

function Hero() {
  return (
    <section className="relative px-6 pb-[80px] pt-[160px] text-center xl:pb-[100px] xl:pt-[190px] 2xl:pb-[110px] 2xl:pt-[210px]">
      <div className="relative mx-auto max-w-[1200px] xl:max-w-[1400px]">
        <div className="fade-up" style={{ animationDelay: "100ms" }}>
          <h1 className="mx-auto mb-7 max-w-[820px] font-serif text-[clamp(2.6rem,6vw,4.5rem)] font-normal leading-[1.05] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:mb-8 xl:max-w-[920px] xl:text-[clamp(2.8rem,5vw,5rem)]">
            Stop Being The Bottleneck.
            <br />
            Install{" "}
            <span className="font-serif italic text-primary">AI Talent.</span>
          </h1>
        </div>
        <div className="fade-up" style={{ animationDelay: "250ms" }}>
          <p className="mx-auto mb-10 max-w-[580px] text-[1.1rem] font-light leading-[1.8] text-[rgba(255,255,255,.6)] xl:mb-12 xl:max-w-[640px] xl:text-[1.2rem]">
            <span className="block">
              We install a done-for-you in-house AI department. Connected to
              everything.
            </span>
            <span className="block">
              So your business scales without more headcount.
            </span>
          </p>
        </div>
        <div className="fade-up" style={{ animationDelay: "400ms" }}>
          <div className="mb-3.5">
            <PrimaryCta>Apply Now →</PrimaryCta>
          </div>
          <p className="text-[13px] font-light text-[rgba(255,255,255,.35)] xl:text-sm">
            Limited spots. Application required.
          </p>
        </div>
      </div>
    </section>
  );
}

function LogoBar() {
  return (
    <section className="px-6 pt-6 pb-14 xl:pt-8 xl:pb-20">
      <div className="mx-auto max-w-5xl xl:max-w-6xl">
        <p className="mb-10 text-center text-[13px] font-medium uppercase tracking-[2px] text-[rgba(255,255,255,.5)] xl:mb-12 xl:text-sm">
          Trusted by <span className="font-bold text-primary">7–9 figure brands</span> like:
        </p>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-12 gap-y-8 sm:gap-x-16 xl:max-w-6xl xl:gap-x-20 xl:gap-y-10">
          {brands.map((brand) => (
            <span
              key={brand}
              className="text-[15px] font-semibold uppercase tracking-[1px] text-[rgba(255,255,255,.55)] transition-colors hover:text-white"
            >
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Shift() {
  return (
    <section className="relative px-6 py-[120px] xl:py-[140px]">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(12,191,106,.03),transparent_65%)]" />
      <div className="relative mx-auto max-w-[1200px] xl:max-w-[1400px]">
        <div className="text-center">
          <SectionTag>The Shift</SectionTag>
          <h2 className="font-serif text-[clamp(1.6rem,3.5vw,2.8rem)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:text-[clamp(2rem,4vw,3.5rem)]">
            More headcount isn&apos;t the answer.
            <br />
            <span className="font-serif italic text-primary">
              Better infrastructure is.
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-[560px] text-base font-light leading-[1.75] text-[rgba(255,255,255,.6)] xl:mt-7 xl:max-w-[640px] xl:text-lg">
            The businesses scaling fastest right now aren&apos;t adding to
            payroll. They&apos;re installing AI systems that do the work of 3–5
            hires, run 24/7, and compound over time.
          </p>
        </div>

        <div className="mt-14 grid gap-12 md:grid-cols-2 xl:mt-20 xl:gap-16">
          <div className="rounded-[20px] border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.015)] p-10 xl:rounded-[24px] xl:p-14">
            <h3 className="mb-6 text-[1.1rem] font-semibold text-[rgba(255,255,255,.35)] xl:mb-8 xl:text-[1.3rem]">
              The Old Way
            </h3>
            <ul className="flex flex-col gap-4">
              {oldWay.map((item) => (
                <li
                  key={item}
                  className="relative pl-6 text-[.9rem] font-light leading-[1.65] text-[rgba(255,255,255,.35)] before:absolute before:left-0 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-[rgba(255,255,255,.08)] xl:pl-7 xl:text-base"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="rounded-[20px] border border-[rgba(10,148,82,.2)] p-10 xl:rounded-[24px] xl:p-14"
            style={{
              background:
                "linear-gradient(160deg, rgba(12,191,106,.06) 0%, rgba(12,191,106,.02) 40%, rgba(255,255,255,.015) 100%)",
            }}
          >
            <h3 className="mb-6 text-[1.1rem] font-semibold text-primary xl:mb-8 xl:text-[1.3rem]">
              In-House AI Department
            </h3>
            <ul className="flex flex-col gap-4">
              {newWay.map((item) => (
                <li
                  key={item}
                  className="relative pl-6 text-[.9rem] font-light leading-[1.65] text-[rgba(255,255,255,.78)] before:absolute before:left-0 before:top-[9px] before:h-2 before:w-2 before:rounded-full before:bg-primary before:shadow-[0_0_8px_rgba(12,191,106,.5)] xl:pl-7 xl:text-base"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Services() {
  return (
    <section
      id="services"
      className="relative px-6 py-[120px] xl:py-[140px]"
    >
      <div className="pointer-events-none absolute left-1/2 top-[20%] h-[600px] w-[800px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(12,191,106,.03),transparent_65%)]" />
      <div className="relative mx-auto max-w-[1200px] xl:max-w-[1400px]">
        <div className="mb-16 text-center">
          <SectionTag>The Transformation</SectionTag>
          <h2 className="font-serif text-[clamp(1.6rem,3.5vw,2.8rem)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:text-[clamp(2rem,4vw,3.5rem)]">
            Your AI Department
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] text-[.95rem] font-light leading-[1.7] text-[rgba(255,255,255,.4)]">
            Four phases. One system. Every department covered.
          </p>
        </div>

        <div className="space-y-8">
          {phases.map((phase, idx) => (
            <div
              key={phase.tag}
              className="group relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)] transition-all duration-[400ms] hover:border-[rgba(255,255,255,.1)] hover:shadow-[0_24px_80px_rgba(0,0,0,.35)]"
            >
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,.06)] to-transparent" />
              <div
                className={`grid gap-0 lg:grid-cols-[1.1fr_1fr] ${
                  idx % 2 === 1 ? "lg:[direction:rtl]" : ""
                }`}
              >
                <div className="relative min-h-[380px] p-3 md:min-h-[440px] md:p-4 xl:min-h-[480px] xl:p-5 [direction:ltr]">
                  <PhaseVisual kind={phase.visual} />
                </div>
                <div className="flex flex-col justify-center px-8 py-10 md:px-10 md:py-12 lg:px-12 xl:px-16 xl:py-16 [direction:ltr]">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(10,148,82,.2)] bg-[rgba(12,191,106,.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[1.5px] text-primary">
                      {phase.tag}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[rgba(255,255,255,.35)]">
                      {phase.when}
                    </span>
                  </div>
                  <h3 className="mb-5 font-serif text-[clamp(1.6rem,2.6vw,2.2rem)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:text-[clamp(1.8rem,2.4vw,2.5rem)]">
                    {phase.title}
                  </h3>
                  <p className="mb-7 text-[.95rem] font-light leading-[1.75] text-[rgba(255,255,255,.6)] xl:text-[1rem]">
                    {phase.body}
                  </p>
                  <ul className="flex flex-col gap-3">
                    {phase.bullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-3 text-[.9rem] font-light leading-[1.6] text-[rgba(255,255,255,.75)] xl:text-[.95rem]"
                      >
                        <svg
                          className="mt-[6px] h-3.5 w-3.5 flex-shrink-0 text-primary"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="mb-5 text-[.95rem] font-light text-[rgba(255,255,255,.5)]">
            Ready to install? <span className="text-primary">8 spots per quarter.</span>
          </p>
          <PrimaryCta>Apply Now →</PrimaryCta>
        </div>
      </div>
    </section>
  );
}

type VisualKind = "audit" | "database" | "board" | "chat";

function PhaseVisual({ kind }: { kind: VisualKind }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[rgba(255,255,255,.06)] bg-[#070B09] shadow-[0_0_80px_rgba(12,191,106,.03),0_2px_40px_rgba(0,0,0,.6)]">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,.06)] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57] opacity-70" />
          <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e] opacity-70" />
          <span className="h-[7px] w-[7px] rounded-full bg-[#28c840] opacity-70" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-[rgba(255,255,255,.3)]">
          rawgrowth
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(12,191,106,.5)]" />
      </div>
      <div className="relative flex-1 p-5">
        {kind === "audit" && <AuditVisual />}
        {kind === "database" && <DatabaseVisual />}
        {kind === "board" && <BoardVisual />}
        {kind === "chat" && <ChatVisual />}
      </div>
    </div>
  );
}

function AuditVisual() {
  const rows = [
    { sys: "Salesforce", dept: "Sales", hrs: "14h/wk" },
    { sys: "Slack", dept: "Comms", hrs: "6h/wk" },
    { sys: "ClickUp", dept: "Ops", hrs: "9h/wk" },
    { sys: "Notion", dept: "Knowledge", hrs: "4h/wk" },
    { sys: "Stripe", dept: "Finance", hrs: "2h/wk" },
    { sys: "Calendly", dept: "Sales", hrs: "11h/wk" },
    { sys: "Microsoft Teams", dept: "Ops", hrs: "7h/wk" },
  ];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[rgba(255,255,255,.5)]">
          System Audit
        </span>
        <span className="text-[10px] font-medium text-primary">4/7 Scanned</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "AI Score", value: "72" },
          { label: "Bottlenecks", value: "9" },
          { label: "Opportunities", value: "14" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)] px-2 py-2"
          >
            <div className="font-serif text-xl text-primary">{s.value}</div>
            <div className="text-[9px] uppercase tracking-[1px] text-[rgba(255,255,255,.4)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-[1.4fr_1fr_.8fr_.6fr] items-center gap-2 border-b border-[rgba(255,255,255,.06)] pb-1 text-[9px] uppercase tracking-[1px] text-[rgba(255,255,255,.4)]">
        <span>System</span>
        <span>Dept</span>
        <span>Hours</span>
        <span>Status</span>
      </div>
      <div className="flex flex-col gap-1 overflow-hidden">
        {rows.map((r, i) => (
          <div
            key={r.sys}
            className="grid grid-cols-[1.4fr_1fr_.8fr_.6fr] items-center gap-2 rounded border border-[rgba(255,255,255,.04)] bg-[rgba(255,255,255,.01)] px-2 py-1.5 text-[11px] text-[rgba(255,255,255,.7)]"
          >
            <span>{r.sys}</span>
            <span className="text-[rgba(255,255,255,.5)]">{r.dept}</span>
            <span className="text-[rgba(255,255,255,.5)]">{r.hrs}</span>
            <span
              className={`inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium uppercase tracking-[0.5px] ${
                i < 4
                  ? "bg-[rgba(12,191,106,.1)] text-primary"
                  : "bg-[rgba(255,255,255,.04)] text-[rgba(255,255,255,.4)]"
              }`}
            >
              {i < 4 ? "done" : "pending"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DatabaseVisual() {
  const sources = [
    "Instagram Content",
    "Best Performing Ads",
    "SOPs",
    "Emails",
    "Sales Calls",
    "SDR Conversations",
    "UTM Tracking",
    "Clients",
  ];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[rgba(255,255,255,.5)]">
          rawgrowth — company database
        </span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          Ingesting...
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {sources.map((s, i) => (
          <div
            key={s}
            className="flex items-center justify-between rounded border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)] px-2.5 py-2 text-[11px] text-[rgba(255,255,255,.7)]"
          >
            <span>{s}</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                i < 5
                  ? "bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]"
                  : "bg-[rgba(255,255,255,.15)]"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Records", value: "1.2M" },
          { label: "Sources", value: "5/8" },
          { label: "Latency", value: "42ms" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)] px-2 py-2"
          >
            <div className="font-mono text-sm text-primary">{s.value}</div>
            <div className="text-[9px] uppercase tracking-[1px] text-[rgba(255,255,255,.4)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardVisual() {
  const cols = [
    {
      title: "To Do",
      items: [
        { text: "Cut 6 reels from podcast ep. 42", tag: "queued" },
        { text: "Send onboarding docs to Acme Corp", tag: "queued" },
        { text: "Score 12 new inbound leads", tag: "queued" },
      ],
    },
    {
      title: "In Progress",
      items: [
        { text: "Follow up with Mark D. — 3 days cold", tag: "working" },
      ],
    },
    {
      title: "Done",
      items: [{ text: "completed today", tag: "24 tasks" }],
    },
  ];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[rgba(255,255,255,.5)]">
          rawgrowth — agent board
        </span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          4 Active
        </span>
      </div>
      <div className="flex gap-1 text-[10px]">
        {["Agents", "Sales", "Content", "Ops", "Analytics"].map((t, i) => (
          <span
            key={t}
            className={`rounded px-2 py-0.5 ${
              i === 0
                ? "bg-[rgba(12,191,106,.12)] text-primary"
                : "bg-[rgba(255,255,255,.04)] text-[rgba(255,255,255,.45)]"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2">
        {cols.map((c) => (
          <div
            key={c.title}
            className="flex flex-col gap-1.5 rounded-lg border border-[rgba(255,255,255,.04)] bg-[rgba(255,255,255,.01)] p-2"
          >
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-[1px] text-[rgba(255,255,255,.4)]">
              {c.title}
            </div>
            {c.items.map((it, i) => (
              <div
                key={i}
                className="rounded border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.03)] p-2 text-[10px] leading-snug text-[rgba(255,255,255,.7)]"
              >
                <div>{it.text}</div>
                <div className="mt-1 text-[9px] text-primary/80">{it.tag}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="text-center text-[10px] text-[rgba(255,255,255,.35)]">
        24/7 autonomous
      </div>
    </div>
  );
}

function ChatVisual() {
  const recents = [
    "Q1 Revenue Breakdown",
    "Client Onboarding SOP",
    "Ad Creative Brief — March",
    "Weekly Pipeline Review",
    "Hiring Scorecard Template",
    "YouTube Strategy",
  ];
  return (
    <div className="grid h-full grid-cols-[130px_1fr] gap-3">
      <div className="flex flex-col gap-2 border-r border-[rgba(255,255,255,.05)] pr-3">
        <div className="text-[10px] font-semibold text-primary">Rawgrowth AI</div>
        <button className="rounded border border-[rgba(12,191,106,.2)] bg-[rgba(12,191,106,.08)] px-2 py-1 text-left text-[10px] text-primary">
          + New chat
        </button>
        <div className="mt-1 text-[9px] uppercase tracking-[1px] text-[rgba(255,255,255,.35)]">
          Recent
        </div>
        {recents.map((r) => (
          <div
            key={r}
            className="truncate rounded px-1.5 py-1 text-[10px] text-[rgba(255,255,255,.55)] hover:bg-white/5"
          >
            {r}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[1px] text-[rgba(255,255,255,.35)]">
            Jake D.
          </span>
          <span className="flex items-center gap-1 text-[10px] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.5)]" />
            Connected
          </span>
        </div>
        <div className="flex-1 space-y-2 overflow-hidden">
          <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-sm bg-[rgba(12,191,106,.12)] px-3 py-2 text-[11px] text-[rgba(255,255,255,.85)]">
            What was our close rate last quarter by lead source?
          </div>
          <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[11px] leading-relaxed text-[rgba(255,255,255,.75)]">
            Q1 close rate by source:
            <ul className="mt-1 space-y-0.5 text-[10px] text-[rgba(255,255,255,.6)]">
              <li>• Inbound — 32% (↑ 6pts)</li>
              <li>• Referral — 44% (↑ 2pts)</li>
              <li>• Cold outbound — 11%</li>
            </ul>
          </div>
        </div>
        <div className="rounded-lg border border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[10px] text-[rgba(255,255,255,.4)]">
          Ask anything about your business...
        </div>
      </div>
    </div>
  );
}

function Results() {
  return (
    <section className="relative px-6 py-[120px] xl:py-[140px]">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(12,191,106,.04),transparent_60%)]" />
      <div className="relative mx-auto max-w-[1200px] xl:max-w-[1400px]">
        <div className="text-center">
          <SectionTag>Results</SectionTag>
          <h2 className="font-serif text-[clamp(1.6rem,3.5vw,2.8rem)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:text-[clamp(2rem,4vw,3.5rem)]">
            Real numbers from{" "}
            <span className="font-serif italic text-primary">real installs.</span>
          </h2>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:mt-20 xl:gap-6">
          {results.map((r) => (
            <div
              key={r.company}
              className="group relative overflow-hidden rounded-[20px] border border-[rgba(10,148,82,.12)] p-8 transition-all duration-[400ms] hover:border-[rgba(10,148,82,.25)] hover:shadow-[0_16px_64px_rgba(12,191,106,.08)] xl:rounded-[24px] xl:p-10"
              style={{
                background:
                  "linear-gradient(160deg, rgba(12,191,106,.06) 0%, rgba(12,191,106,.02) 40%, rgba(255,255,255,.015) 100%)",
              }}
            >
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(12,191,106,.15)] to-transparent" />
              <div className="relative mb-6 flex items-center gap-4">
                <span className="text-[13px] font-semibold uppercase tracking-[1.5px] text-[rgba(255,255,255,.85)]">
                  {r.company}
                </span>
              </div>
              <div className="relative mb-4">
                <span className="font-serif text-[clamp(1.5rem,2.6vw,2rem)] font-normal tracking-[-0.02em] text-primary drop-shadow-[0_0_20px_rgba(12,191,106,.15)]">
                  {r.metric}
                </span>
              </div>
              <p className="relative text-[.95rem] font-light leading-[1.7] text-[rgba(255,255,255,.6)]">
                {r.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-[120px] xl:py-[140px]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-full w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_80%,rgba(12,191,106,.06),transparent_55%)]" />
      <div className="relative mx-auto max-w-[800px] text-center xl:max-w-[960px]">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[rgba(10,148,82,.2)] bg-[rgba(12,191,106,.08)] px-4.5 py-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_rgba(12,191,106,.25)]" />
          <span className="text-xs font-medium text-primary">8 spots per quarter</span>
        </div>
        <h2 className="font-serif text-[clamp(1.6rem,3.5vw,2.8rem)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,.92)] xl:text-[clamp(2rem,4vw,3.5rem)]">
          Your competitors are installing
          <br />
          AI systems{" "}
          <span className="font-serif italic text-primary">right now.</span>
        </h2>
        <p className="mx-auto mt-5 mb-10 max-w-[560px] text-base font-light leading-[1.75] text-[rgba(255,255,255,.6)] xl:mt-7 xl:mb-12 xl:max-w-[640px] xl:text-lg">
          Every month without systems is a month they compound and you
          don&apos;t. The businesses that install now will be unreachable in 12
          months.
        </p>
        <PrimaryCta>Apply Now →</PrimaryCta>
        <p className="mt-3.5 text-[13px] font-light text-[rgba(255,255,255,.35)] xl:text-sm">
          Limited spots. Application required.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-[rgba(255,255,255,.06)] px-6 py-12 text-center text-xs font-light text-[rgba(255,255,255,.35)]">
      © 2026{" "}
      <strong className="font-semibold text-[rgba(255,255,255,.6)]">
        Rawgrowth
      </strong>
      . All rights reserved.
    </footer>
  );
}
