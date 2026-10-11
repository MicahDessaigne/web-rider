// js/levels.js — 32 hand-tuned levels (seeded procedural tracks)
(function(root) {
  const NAMES = ['Tutorial Run', "Spider's First Web", 'Wall Crawl', 'Uptown Swing', 'Rooftop Hustle', 'Daily Bugle Dash',
    'Queens Cruise', 'Thwip Thwip', 'Spider-Sense Tingle', 'Midtown Mayhem', 'Web Slinger', 'Night Patrol',
    'Brooklyn Bridge Blitz', 'Neon Alley', 'Spidey Leap', 'Goblin Glider Chase', 'Venom Valley', 'Rhino Rampage',
    'Electro Circuit', 'Sandstorm Streets', 'Vulture Heights', 'Mysterio Maze', 'Scorpion Sting', 'Lizard Sewers',
    'Kraven Hunt', 'Sinister Six Sprint', 'Doc Ock Tentacles', 'Carnage Canyon', 'Multiverse Rift', 'Spider-Verse Surge',
    'Avengers Tower Run', 'Final Challenge'];
  const LEVELS = NAMES.map((name, i) => {
    const t = i / 31, length = Math.round((300 + t * 1700) / 10) * 10, difficulty = Math.round((1 + t * 9) * 10) / 10;
    return { id: i + 1, name, seed: 1001 + i, length, difficulty, theme: i % 10,
      description: `${length}m · difficulty ${Math.round(difficulty)}/10`,
      starTargets: { one: 0, two: Math.round(length * 1.6 / 50) * 50, three: Math.round(length * 3 / 50) * 50 } };
  });
  root.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
