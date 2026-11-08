/**
 * Design samples: eight more stories, in the agreement's story shape, so the design pages show
 * a full board with every category's look. They exist only on the design pages, are written in
 * our own words, name no real person, and pass the agreement's own check (samples.test.ts).
 * The agreement's five example stories (agreement/examples/stories.json) stay the main cast:
 * they carry the hard cases (a correction, a merged story, a missing image, a long title).
 */

export type SampleStory = {
  story: {
    format: 'story/1';
    id: string;
    title: string;
    summary: string;
    locations: string[];
    categories: string[];
    state: 'live';
    created_at: string;
    updated_at: string;
  };
  /** When each of its updates was reported, oldest first. */
  updateTimes: string[];
  /** Its newest update's headline. */
  latest: string;
};

export const sampleStories: SampleStory[] = [
  {
    story: {
      format: 'story/1',
      id: '01a1a488-ef40-752e-89a7-834df2a74de4',
      title: 'Delhi brings back odd-even driving for five days as the smog lingers',
      summary:
        'Cars with odd and even number plates take turns on the roads from Monday. Buses and the metro add services.',
      locations: ['delhi-ncr', 'india'],
      categories: ['politics', 'general'],
      state: 'live',
      created_at: '2026-11-04T03:10:00Z',
      updated_at: '2026-11-04T14:45:00Z',
    },
    updateTimes: [
      '2026-11-04T03:00:00Z',
      '2026-11-04T06:30:00Z',
      '2026-11-04T10:10:00Z',
      '2026-11-04T14:45:00Z',
    ],
    latest: 'Fines start on the first day; buses and the metro add services',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a516-d760-7651-8317-1ff4a6a3a450',
      title: 'A small Marathi film passes ₹100 crore at the box office in its third week',
      summary:
        'Made for a fraction of a studio budget, it kept adding screens across Maharashtra on word of mouth.',
      locations: ['mumbai', 'india'],
      categories: ['entertainment'],
      state: 'live',
      created_at: '2026-11-04T05:45:00Z',
      updated_at: '2026-11-04T05:45:00Z',
    },
    updateTimes: ['2026-11-04T05:30:00Z'],
    latest: 'It opens in Hindi-speaking states next Friday',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a19a-33c0-7128-a24b-e40ad23f0824',
      title: 'The rupee steadies after the central bank leaves interest rates unchanged',
      summary:
        'The bank kept its main rate where it was and said prices are rising more slowly. Bank shares rose.',
      locations: ['india'],
      categories: ['finance'],
      state: 'live',
      created_at: '2026-11-03T13:30:00Z',
      updated_at: '2026-11-03T15:05:00Z',
    },
    updateTimes: ['2026-11-03T13:20:00Z', '2026-11-03T15:05:00Z'],
    latest: 'Bank shares close higher after the decision',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a5c9-5e80-7181-a54c-66175d9dc9f8',
      title: "Trial runs on Bengaluru's newest metro line start next month",
      summary:
        'Trains will run empty along the line for weeks of safety checks before it opens to passengers.',
      locations: ['bengaluru'],
      categories: ['general'],
      state: 'live',
      created_at: '2026-11-04T09:00:00Z',
      updated_at: '2026-11-04T09:00:00Z',
    },
    updateTimes: ['2026-11-04T08:50:00Z'],
    latest: 'Trains will run empty for six weeks of safety checks',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a649-8b00-70ed-a079-d3bde8e25d94',
      title: "A stoppage-time penalty settles the league's top-of-the-table clash",
      summary:
        'The leaders keep their three-point lead, and the side in second finish the match with ten players.',
      locations: ['global'],
      categories: ['sports'],
      state: 'live',
      created_at: '2026-11-04T11:20:00Z',
      updated_at: '2026-11-04T12:10:00Z',
    },
    updateTimes: ['2026-11-04T11:05:00Z', '2026-11-04T11:40:00Z', '2026-11-04T12:10:00Z'],
    latest: 'The side in second finish with ten players',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a079-cfa0-736f-8580-28d6099950d8',
      title: 'Food-delivery apps raise their platform fee again before the wedding season',
      summary:
        'Both of the biggest apps now add a few rupees more to every order, saying it pays for faster delivery.',
      locations: ['india', 'mumbai'],
      categories: ['business'],
      state: 'live',
      created_at: '2026-11-03T08:15:00Z',
      updated_at: '2026-11-04T07:30:00Z',
    },
    updateTimes: ['2026-11-03T08:00:00Z', '2026-11-04T07:30:00Z'],
    latest: 'Both apps say the fee pays for faster delivery',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a448-d900-76f0-8478-82e36b0d549b',
      title: 'A new open AI model matches far larger rivals on school maths tests',
      summary:
        'Its makers say it runs on a single graphics card. Independent testers are checking the results.',
      locations: ['global'],
      categories: ['ai'],
      state: 'live',
      created_at: '2026-11-04T02:00:00Z',
      updated_at: '2026-11-04T13:00:00Z',
    },
    updateTimes: ['2026-11-04T01:45:00Z', '2026-11-04T09:20:00Z', '2026-11-04T13:00:00Z'],
    latest: 'Independent testers start checking the results',
  },
  {
    story: {
      format: 'story/1',
      id: '01a1a692-c900-73d9-a344-5bb31738f7d9',
      title: "India's crypto exchanges report record sign-ups as Bitcoin returns above $100,000",
      summary: 'Two of the largest exchanges said new accounts doubled this week.',
      locations: ['india'],
      categories: ['crypto', 'finance'],
      state: 'live',
      created_at: '2026-11-04T12:40:00Z',
      updated_at: '2026-11-04T15:50:00Z',
    },
    updateTimes: ['2026-11-04T12:30:00Z', '2026-11-04T15:50:00Z'],
    latest: 'One exchange says most new users are under 30',
  },
];
