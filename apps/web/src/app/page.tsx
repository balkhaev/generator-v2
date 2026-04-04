import OperatorConsole from "@/components/operator-console";

export default function Home() {
  return (
    <main className="container mx-auto grid max-w-7xl gap-8 px-4 py-6">
      <section className="grid gap-3 border px-6 py-6">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          ComfyUI Runpod operator MVP
        </p>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:items-end">
          <div className="grid gap-3">
            <h1 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              Scenario creation, reruns, and run review from one admin surface.
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              This web lane is wired around the MVP operator flow: save reusable scenarios for the
              <code className="mx-1 border px-1 py-0.5 font-mono text-[11px]">ltx-2.3 i2v</code>
              workflow, relaunch them against new input images, and keep provider job state visible.
            </p>
          </div>
          <div className="grid gap-2 border border-dashed px-4 py-4 text-xs text-muted-foreground">
            <p>Current focus</p>
            <ul className="grid gap-1">
              <li>- scenario create/edit-ready form</li>
              <li>- rerun launcher for new input images</li>
              <li>- run review with provider ids and artifact links</li>
            </ul>
          </div>
        </div>
      </section>
      <OperatorConsole />
    </main>
  );
}
