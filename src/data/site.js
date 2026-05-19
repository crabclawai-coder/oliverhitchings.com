export const site = {
  name: "Oliver Hitchings",
  url: "https://oliverhitchings.com",
  email: "oliverhitch2008@gmail.com",
  availability: "Accepting 1 client · May 2026",
  description:
    "Practical automation systems for repeatable business tasks, with clear handover, useful logs, and human control.",
  cta: {
    primary: "View packages",
    secondary: "See services",
  },
};

export const contactHref = `mailto:${site.email}?subject=${encodeURIComponent(
  "Automation package enquiry",
)}&body=${encodeURIComponent(
  "Hi Oliver,\n\nI would like to talk about automating a repeatable task.\n\nThe task I have in mind is:\n\nThe systems involved are:\n\nThe outcome I want is:\n",
)}`;

export const posts = [
  {
    slug: "what-a-good-first-build-proves",
    title: "What a first automation project should prove",
    date: "2026-05-19",
    summary:
      "The first build should prove whether one task can be run repeatedly with logs, handoffs, and clear failure handling.",
    category: "Project design",
    body: [
      "A good first project starts with one task that already happens often enough to be painful. The goal is not to automate a whole department in one pass. The goal is to prove that a small, repeatable loop can be trusted.",
      "That means clear inputs, expected outputs, evidence trails, and a way for a person to review or stop it. The early win is usually not glamour. It is one recurring job that stops taking attention every week.",
      "If the build survives real data, real delays, and real edge cases, it earns the right to become permanent infrastructure. If it does not, the business still leaves with a precise map of the process and the weak points.",
    ],
  },
  {
    slug: "local-first-is-an-operating-choice",
    title: "Local-first is an operating choice",
    date: "2026-05-18",
    summary:
      "Running automations on owned infrastructure keeps the system inspectable, controllable, and easier to reason about when something breaks.",
    category: "Infrastructure",
    body: [
      "Local-first does not mean pretending the cloud does not exist. It means the default control plane belongs to the business using the system. Prompts, scripts, schedules, logs, and data handling should be visible.",
      "Cloud models can still be useful for hard reasoning, long-context review, or specialist steps. The important distinction is that escalation is deliberate. The owned system decides when to ask for help, records what happened, and remains understandable afterwards.",
      "That approach is slower to sell than a black-box SaaS dashboard, but it is easier to operate. The team can see what changed, inspect the run history, and decide what should happen next.",
    ],
  },
  {
    slug: "automation-is-an-operations-project",
    title: "Automation is an operations project",
    date: "2026-05-17",
    summary:
      "The hard part is rarely the model call. It is deciding what should happen before, during, and after the agent acts.",
    category: "Field note",
    body: [
      "Most useful agent work starts as operations work. Who owns the output? What counts as a failure? Which source of truth wins? What should be logged? Who gets interrupted when confidence is low?",
      "The model is one part of that system, not the system itself. Good automation has boring edges: retry rules, approval points, clear naming, small runbooks, and enough logging to debug a bad day.",
      "That is why I treat agent projects as workflow design first and implementation second. The code matters, but the operating model is what makes it safe to use every week.",
    ],
  },
];
