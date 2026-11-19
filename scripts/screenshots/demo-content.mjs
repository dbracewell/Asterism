// The fictional demo dataset for the user-guide screenshots (US-89.1): people,
// files, and the scripted model replies. Everything here is invented; no real
// names, addresses or material.

export const PASSWORD = "Demo-guide-password-89!";

/** The demo accounts. The first is the administrator created in first-run setup. */
export const people = {
  admin: { name: "Sam Rivera", email: "sam.rivera@example.test" },
  educator: { name: "Dana Okafor", email: "dana.okafor@example.test" },
  student: { name: "Maya Chen", email: "maya.chen@example.test" },
  classmate: { name: "Leo Martins", email: "leo.martins@example.test" },
};

export const MODELS = { tutor: "Demo Tutor", writer: "Demo Writer" };

const PHOTOSYNTHESIS_NOTES = `# Photosynthesis: lecture notes

Photosynthesis turns light energy into chemical energy stored in sugar. It takes
place in the chloroplasts of plant cells and has two stages.

## The light-dependent reactions

The light-dependent reactions happen in the thylakoid membranes. Chlorophyll
absorbs mostly red and blue light. The energy splits water molecules, which
releases oxygen as a by-product. The captured energy is stored in two carrier
molecules, ATP and NADPH.

## The Calvin cycle

The Calvin cycle happens in the stroma, the fluid around the thylakoids. It uses
the ATP and NADPH from the light-dependent reactions to fix carbon dioxide into
a three-carbon sugar. The enzyme RuBisCO performs the first step, joining carbon
dioxide to a five-carbon molecule called RuBP.

## Limiting factors

The rate of photosynthesis depends on light intensity, carbon dioxide
concentration and temperature. Whichever factor is in shortest supply limits the
rate.
`;

const CELL_RESPIRATION = `Cellular respiration: reading summary

Cellular respiration releases the energy stored in glucose. It is roughly the
reverse of photosynthesis: glucose and oxygen go in, carbon dioxide, water and
ATP come out.

Glycolysis happens in the cytoplasm and splits glucose into two pyruvate
molecules. The Krebs cycle and the electron transport chain happen in the
mitochondria and make most of the ATP.

Without oxygen, cells fall back on fermentation, which makes far less ATP.
`;

const LAB_DATA = `light_intensity_percent,bubbles_per_minute
0,0
20,6
40,13
60,19
80,22
100,23
`;

const LAB_REPORT_DRAFT = `Lab report draft: the effect of light on photosynthesis

Aim: to find out how light intensity affects the rate of photosynthesis in pondweed.

Method: we placed pondweed in water under a lamp and counted oxygen bubbles for
one minute at six light levels.

Results: the bubble rate rose quickly up to 60% light and then levelled off.

Conclusion: more light always means more photosynthesis.
`;

/**
 * Demo files, uploaded by the student. `html` files are rendered to PDF or PNG
 * by the browser, so the library shows several real formats.
 */
export const files = [
  {
    name: "photosynthesis-notes.md",
    type: "text/markdown",
    text: PHOTOSYNTHESIS_NOTES,
  },
  { name: "cell-respiration.txt", type: "text/plain", text: CELL_RESPIRATION },
  { name: "pondweed-results.csv", type: "text/csv", text: LAB_DATA },
  { name: "lab-report-draft.txt", type: "text/plain", text: LAB_REPORT_DRAFT },
  {
    name: "chloroplast-handout.pdf",
    type: "application/pdf",
    html: `<h1 style="font-family:Georgia,serif">The chloroplast</h1>
<p style="font:16px/1.6 Georgia,serif;max-width:36em">A chloroplast is surrounded by two membranes. Inside are stacks of
thylakoids, called grana, where the light-dependent reactions take place. The fluid
around them is the stroma, where the Calvin cycle runs. Chloroplasts contain their own
DNA and ribosomes.</p>`,
  },
  {
    name: "leaf-diagram.png",
    type: "image/png",
    html: `<div style="width:640px;height:400px;display:grid;place-items:center;background:#f4f9f1;font:20px system-ui">
<svg width="560" height="340" viewBox="0 0 560 340"><path d="M40 170 C160 20 400 20 520 170 C400 320 160 320 40 170Z" fill="#7cb66a" stroke="#3d7a33" stroke-width="4"/>
<path d="M40 170 L520 170" stroke="#3d7a33" stroke-width="3"/><text x="280" y="60" text-anchor="middle" fill="#234">Sunlight</text>
<text x="120" y="250" fill="#123">CO₂ in</text><text x="380" y="250" fill="#123">O₂ out</text></svg></div>`,
  },
];

/** The project the student works in, with its files. */
export const project = {
  name: "Biology 101",
  description: "Unit 3: how plants make and use energy.",
  goal: "Be ready for the unit 3 test on photosynthesis and respiration.",
  files: [
    "photosynthesis-notes.md",
    "cell-respiration.txt",
    "pondweed-results.csv",
    "lab-report-draft.txt",
    "chloroplast-handout.pdf",
  ],
};

export const subAgent = {
  name: "Lab report checker",
  description: "Reads a lab report draft and lists what is missing.",
  system_prompt:
    "You check science lab reports. List missing sections, unsupported conclusions and unclear units. Do not rewrite the report.",
};

export const DEFAULT_REPLY =
  "I can help with that. Could you tell me a little more about what you are working on, so I can give you a useful answer?";

/**
 * Scripted chat turns. `match` is found in the user's message; `search` makes
 * the model search the project's files first; `{cite:N}` cites the Nth passage
 * the search returned. A script with `answers` gives the next one each time it
 * answers, so a regenerated reply differs from the first.
 */
export const chats = [
  {
    match: "how photosynthesis works",
    title: "Photosynthesis for Friday's test",
    answer: `Let's work through it together rather than me just listing facts.

Photosynthesis is how plants turn light into stored chemical energy. It happens in **two stages** inside the chloroplast.

Before I explain them: what do you think a plant needs to take in to make its food? Try naming three things, and I'll build on your answer.`,
  },
  {
    match: "light-dependent reactions",
    title: "Light-dependent reactions",
    search: "light-dependent reactions thylakoid ATP NADPH",
    answer: `According to your files, the light-dependent reactions [take place in the thylakoid membranes]({cite:1}) of the chloroplast.

1. **Light is absorbed.** Chlorophyll absorbs mostly red and blue light.
2. **Water is split.** The energy splits water molecules, which [releases oxygen as a by-product]({cite:1}).
3. **Energy is stored.** The captured energy ends up in two carrier molecules, **ATP** and **NADPH**, which the Calvin cycle uses next.

Would you like a quick question to check your understanding?`,
  },
  {
    // Regenerating gives the next answer, so the two branches differ.
    match: "explain the calvin cycle",
    title: "The Calvin cycle",
    search: "Calvin cycle stroma RuBisCO",
    answers: [
      `In simple terms: the Calvin cycle is the plant's sugar factory.

It runs in the [stroma, the fluid around the thylakoids]({cite:1}). It takes carbon dioxide from the air and, powered by the ATP and NADPH made in the light, builds it into sugar.`,
      `The Calvin cycle has three phases, all in the stroma:

1. **Carbon fixation.** The enzyme [RuBisCO joins carbon dioxide to RuBP]({cite:1}), a five-carbon molecule.
2. **Reduction.** ATP and NADPH turn the products into a three-carbon sugar (G3P).
3. **Regeneration.** Most of the G3P is used to rebuild RuBP, so the cycle can continue.

For every three turns of the cycle, one G3P molecule leaves to become glucose and other sugars.`,
    ],
  },
  {
    match: "outline for my lab report",
    title: "Lab report outline",
    answer: `I've started an outline for your lab report in the canvas. It follows the usual sections: aim, hypothesis, method, results, analysis and conclusion.

Look at the **Conclusion** section first. Your draft says "more light always means more photosynthesis", but your results level off after 60% light. What might explain that?`,
  },
  {
    match: "flashcards",
    title: "Making flashcards",
    answer: `Flashcards are a good way to review this unit. Open **Study** in your Biology 101 project and choose **Draft cards from files**. I'll suggest cards from your notes, and you decide which ones to keep.`,
  },
];

/** The canvas document seeded in the lab report chat. */
export const canvas = {
  kind: "document",
  title: "Lab report outline",
  content: `# The effect of light on photosynthesis

## Aim
Find out how light intensity affects the rate of photosynthesis in pondweed.

## Hypothesis
As light intensity increases, the rate of photosynthesis increases, until another factor becomes limiting.

## Method
- Place pondweed in water under a lamp.
- Count oxygen bubbles for one minute at six light levels (0% to 100%).
- Repeat each level three times and take the mean.

## Results
A table and a line graph of bubbles per minute against light intensity.

## Analysis
Describe the shape of the graph. Where does the rate stop rising?

## Conclusion
Answer the aim, using your data.
`,
};

const cards = [
  {
    front: "Where do the light-dependent reactions take place?",
    back: "In the thylakoid membranes of the chloroplast.",
  },
  { front: "What gas is released when water is split?", back: "Oxygen." },
  {
    front: "Which two molecules carry energy to the Calvin cycle?",
    back: "ATP and NADPH.",
  },
  { front: "Where does the Calvin cycle take place?", back: "In the stroma." },
  {
    front: "What does the enzyme RuBisCO do?",
    back: "It joins carbon dioxide to RuBP, the first step of the Calvin cycle.",
  },
  {
    front: "Name three limiting factors of photosynthesis.",
    back: "Light intensity, carbon dioxide concentration and temperature.",
  },
];

/** Cards added straight to the seeded deck (the drafting screenshots use the scripted model). */
export const deck = {
  name: "Photosynthesis",
  description: "Key facts for the unit 3 test.",
  cards,
};

export const notes = [
  {
    kind: "summary",
    title: "Summary: photosynthesis notes",
    body: `## Two stages

Photosynthesis has two stages. The light-dependent reactions in the thylakoids capture light, split water and store energy in ATP and NADPH. The Calvin cycle in the stroma uses that energy to fix carbon dioxide into sugar.

## What limits the rate

Light intensity, carbon dioxide concentration and temperature. The one in shortest supply sets the rate.`,
  },
];

const quizQuestions = [
  {
    type: "multiple_choice",
    prompt: "Where do the light-dependent reactions take place?",
    options: [
      "In the stroma",
      "In the thylakoid membranes",
      "In the mitochondria",
      "In the cell wall",
    ],
    answer: 1,
    explanation:
      "The notes say the light-dependent reactions happen in the thylakoid membranes.",
    source: "S1",
  },
  {
    type: "multiple_choice",
    prompt: "Which gas is released as a by-product of splitting water?",
    options: ["Carbon dioxide", "Nitrogen", "Oxygen"],
    answer: 2,
    explanation: "Splitting water releases oxygen.",
    source: "S1",
  },
  {
    type: "short_answer",
    prompt:
      "Explain why the rate of photosynthesis stops rising at high light intensity.",
    rubric:
      "Another factor, such as carbon dioxide concentration or temperature, becomes limiting.",
    source: "S1",
  },
  {
    type: "multiple_choice",
    prompt: "Which enzyme performs the first step of the Calvin cycle?",
    options: ["Amylase", "RuBisCO", "ATP synthase", "Catalase"],
    answer: 1,
    explanation: "RuBisCO joins carbon dioxide to RuBP.",
    source: "S1",
  },
];

/** The days from the study guide request, so the plan stays inside its range. */
function guideDays(user) {
  const [, from, to] =
    /from (\d{4}-\d{2}-\d{2}) to the exam on (\d{4}-\d{2}-\d{2})/.exec(user) ??
    [];
  if (!from) return [];
  const focus = [
    "Light-dependent reactions",
    "The Calvin cycle",
    "Limiting factors",
    "Practice quiz",
    "Light review",
  ];
  const days = [];
  for (
    let day = new Date(`${from}T00:00:00Z`), index = 0;
    day <= new Date(`${to}T00:00:00Z`);
    index += 1
  ) {
    const last = day.getTime() === new Date(`${to}T00:00:00Z`).getTime();
    days.push({
      date: day.toISOString().slice(0, 10),
      focus: last ? "Exam day" : focus[Math.min(index, focus.length - 1)],
      tasks: last
        ? [
            {
              text: "Review the cards you missed once, then rest.",
              minutes: 10,
              deck: "D1",
              quiz: null,
            },
          ]
        : [
            {
              text: "Review the due flashcards.",
              minutes: 15,
              deck: "D1",
              quiz: null,
            },
            index >= 2
              ? {
                  text: "Take the practice quiz and check your mistakes.",
                  minutes: 20,
                  deck: null,
                  quiz: "Q1",
                }
              : {
                  text: "Reread the matching section of your notes.",
                  minutes: 20,
                  deck: null,
                  quiz: null,
                },
          ],
    });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

/** Replies to the study generators, matched by the start of their system prompts. */
export const study = [
  {
    prompt: "You write study flashcards",
    reply: () => ({ cards: cards.map((card) => ({ ...card, source: "S1" })) }),
  },
  {
    prompt: "You write practice quiz questions",
    reply: () => ({ questions: quizQuestions }),
  },
  {
    prompt: "You summarize a learner's course material",
    reply: () => ({
      sections: [
        {
          heading: "Two stages",
          text: "The light-dependent reactions in the thylakoids capture light and store energy in ATP and NADPH. The Calvin cycle in the stroma uses that energy to fix carbon dioxide into sugar.",
          sources: ["S1"],
        },
        {
          heading: "Limiting factors",
          text: "Light intensity, carbon dioxide concentration and temperature limit the rate.",
          sources: ["S1"],
        },
      ],
    }),
  },
  {
    prompt: "You plan a learner's study days",
    reply: (user) => ({ days: guideDays(user) }),
  },
];

/** The educator's own file, published with the course. */
export const courseFile = {
  name: "unit-3-overview.md",
  type: "text/markdown",
  text: `# Unit 3 overview: energy in living things

In this unit you will learn how plants capture energy from light (photosynthesis)
and how all living cells release energy from food (cellular respiration).

By the end of the unit you should be able to:

- describe the two stages of photosynthesis and where each happens;
- explain what limits the rate of photosynthesis;
- compare photosynthesis with cellular respiration.

The unit test is on the last Friday of the unit.
`,
};

/** The class the educator runs, published from the educator's own project. */
export const classroom = {
  name: "Biology 101 · Period 3",
  description: "Unit 3: photosynthesis and respiration.",
  course: {
    name: "Biology 101 course",
    description: "Notes and practice for unit 3.",
  },
};
