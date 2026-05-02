const streakEl = document.getElementById('streak');
const messageEl = document.getElementById('message');
const button = document.getElementById('boostBtn');

const phrases = [
  'Nice. Keep the chain alive.',
  'Momentum unlocked 🔓',
  'You are on fire today 🔥',
  'One more for a new best?'
];

let streak = Number(localStorage.getItem('focus-streak') || 0);
streakEl.textContent = streak;

button.addEventListener('click', () => {
  streak += 1;
  localStorage.setItem('focus-streak', String(streak));
  streakEl.textContent = streak;
  messageEl.textContent = phrases[Math.floor(Math.random() * phrases.length)];

  button.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.04)' },
      { transform: 'scale(1)' }
    ],
    { duration: 180, easing: 'ease-out' }
  );
});
