import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { PawPrint, Activity, NotebookPen, ShieldCheck } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-bone text-foreground">
      <header className="px-6 md:px-12 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display font-bold text-xl" data-testid="brand-logo">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#C96A52] text-white">
            <PawPrint size={18} />
          </span>
          PawPrint Rx
        </div>
        <nav className="flex items-center gap-3">
          <Link to="/login" data-testid="nav-login">
            <Button variant="ghost" className="rounded-full">Sign in</Button>
          </Link>
          <Link to="/signup" data-testid="nav-signup">
            <Button className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]">Get started</Button>
          </Link>
        </nav>
      </header>

      <section className="px-6 md:px-12 pt-10 md:pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-7 animate-fade-up">
          <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">PawPrint Rx · For canine rehab teams</p>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl tracking-tight font-bold leading-[0.95]">
            Tailored exercise plans <span className="text-[#C96A52]">for every dog</span> in your care.
          </h1>
          <p className="text-lg text-[#3a3a36] max-w-xl leading-relaxed">
            Build a custom library of canine rehab exercises, assemble plans for your patients, and let owners log their dog's progress at home with photos, reps and pain scores.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/signup?role=clinician" data-testid="cta-clinician">
              <Button size="lg" className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-12 px-7">I'm a clinician</Button>
            </Link>
            <Link to="/signup?role=owner" data-testid="cta-owner">
              <Button size="lg" variant="outline" className="rounded-full border-[#C96A52] text-[#C96A52] hover:bg-[#C96A52]/10 h-12 px-7">I'm a pet parent</Button>
            </Link>
          </div>
          <div className="flex items-center gap-6 pt-4 text-sm text-[#787672]">
            <div className="flex items-center gap-2"><ShieldCheck size={16} /> HIPAA-style privacy</div>
            <div className="flex items-center gap-2"><Activity size={16} /> Pain trend charts</div>
            <div className="flex items-center gap-2"><NotebookPen size={16} /> Owner diary</div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 bg-[#E8E2D9] rounded-[2.5rem] -rotate-2"></div>
          <img
            alt="Golden retriever enjoying a lake day"
            src="/landing-hero.jpg"
            className="relative rounded-[2rem] w-full h-[520px] object-cover shadow-sm"
          />
          <div className="absolute -bottom-6 -left-6 bg-white rounded-2xl p-5 border border-[#E2DFD8] w-64">
            <p className="text-xs tracking-widest uppercase font-bold text-[#787672]">Today's plan</p>
            <p className="font-display font-semibold mt-1">Cavaletti walk · 3×5</p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="h-2 flex-1 rounded-full bg-[#E8E2D9] overflow-hidden">
                <span className="block h-full w-2/3 bg-[#5B7566]" />
              </span>
              <span className="text-[#5B7566] font-semibold">66%</span>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-12 pb-20 grid md:grid-cols-3 gap-6">
        {[
          { t: "Custom exercise library", d: "Pre-loaded with 18 canine rehab staples. Add your own with image or video demos.", icon: <Activity /> },
          { t: "Plan builder", d: "Drag exercises into a plan, set reps, sets and frequency. Assign to a patient in seconds.", icon: <NotebookPen /> },
          { t: "Owner home tracking", d: "Owners log completion, actual reps, pain score and a photo. You see trends instantly.", icon: <PawPrint /> },
        ].map((f, i) => (
          <div key={i} className="bg-white border border-[#E2DFD8] rounded-3xl p-8" data-testid={`feature-${i}`}>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#E8E2D9] text-[#C96A52]">{f.icon}</span>
            <h3 className="font-display text-xl font-semibold mt-5">{f.t}</h3>
            <p className="text-[#3a3a36] mt-2 leading-relaxed">{f.d}</p>
          </div>
        ))}
      </section>

      <footer className="px-6 md:px-12 py-8 border-t border-[#E2DFD8] text-sm text-[#787672]">
        © {new Date().getFullYear()} PawPrint Rx
      </footer>
    </div>
  );
}
