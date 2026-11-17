// Theme toggling and venture filtering logic

document.addEventListener('DOMContentLoaded', () => {

    // --- Webina AI Waitlist Form ---
const waitlistForm = document.getElementById('waitlist-form');
const waitlistSuccess = document.getElementById('waitlist-success');
const waitlistSuccessText = document.getElementById('waitlist-success-text');

if (waitlistForm) {
    waitlistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wl-name').value.trim();
        const email = document.getElementById('wl-email').value.trim();
        const role = document.getElementById('wl-role').value;

        // Optional: Replace with your Make / n8n / Formspree webhook URL
        const WEBHOOK_URL = '';

        if (WEBHOOK_URL) {
            try {
                await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, role, source: 'webina.io/webina-ai' })
                });
            } catch (err) {
                console.error('Webhook submission error:', err);
            }
        }

        waitlistForm.classList.add('hidden');
        waitlistSuccess.classList.remove('hidden');
        waitlistSuccessText.textContent = `Thanks, ${name}! We've added ${email} to the Webina AI early access list.`;
    });
}
    // --- Theme Toggle ---
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const htmlElement = document.documentElement;

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        htmlElement.classList.add('dark');
        themeIcon.className = 'fa-solid fa-sun';
    } else {
        htmlElement.classList.remove('dark');
        themeIcon.className = 'fa-solid fa-moon';
    }

    themeToggleBtn.addEventListener('click', () => {
        if (htmlElement.classList.contains('dark')) {
            htmlElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            themeIcon.className = 'fa-solid fa-moon';
        } else {
            htmlElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            themeIcon.className = 'fa-solid fa-sun';
        }
    });

    // --- Ventures Filtering ---
    const filterButtons = document.querySelectorAll('.filter-btn');
    const ventureCards = document.querySelectorAll('.venture-card');

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.classList.remove('bg-gradient-to-r', 'from-indigo-600', 'to-purple-600', 'text-white', 'shadow-sm');
                b.classList.add('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
            });
            btn.classList.remove('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
            btn.classList.add('bg-gradient-to-r', 'from-indigo-600', 'to-purple-600', 'text-white', 'shadow-sm');

            const filterValue = btn.getAttribute('data-filter');

            ventureCards.forEach(card => {
                const category = card.getAttribute('data-category');
                if (filterValue === 'all' || category === filterValue) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });
});
