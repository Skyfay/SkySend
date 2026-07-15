import { STATS } from "@/lib/content";

export function StatsBand() {
  return (
    <section className="border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 py-10 sm:grid-cols-4 sm:gap-8">
        {STATS.map((stat) => (
          <div key={stat.label} className="text-center">
            <p className="text-2xl font-bold sm:text-3xl">{stat.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
