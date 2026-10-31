# Larry: talk to someone, not something

Larry helps lonely and socially anxious people meet real friends in the real world. You make a **taste card** by tapping pictures (films, TV, music, games, books, sport, podcasts and more). You start a **group** with friends by showing a QR code. Larry uses [Qloo](https://qloo.com)'s taste graph to find what you really have in common, then turns it into a **Plan Ticket** for a real, open place nearby. You go, you check in, and you earn **Glory**.

Built for the **Qloo Agentic Hackathon** ("Agents, but with taste.").

## The flow

1. **Taste card.** Tap posters and covers from Qloo. No account needed to make one.
2. **Group by QR.** Start a group, show its QR, and whoever scans it joins. Scanning is the consent.
3. **Common ground.** Larry opens the group with what you all share, from Qloo, with a "Why this?" for each pick.
4. **Plan Ticket.** Tag @Larry and it picks one real place that fits everyone, with a time, an easy opener and a plan B.
5. **Check-in.** At the place, check in when you arrive and when you leave. Only real visits count.
6. **Glory.** Real visits earn Glory and titles. Nothing is earned from screen time.

There is also a solo chat ("Talk taste with Larry") that learns your taste, and practice partners.

- **The app:** [`common-ground/`](common-ground/). Next.js 16, TypeScript and Tailwind v4, with a Claude agent and Qloo's Insights API. See [`common-ground/README.md`](common-ground/README.md) for features, how Qloo and the agent are used, privacy and safety, and how to run it.

## Quick start

```bash
cd common-ground
npm install
cp .env.example .env.local   # add QLOO_KEY, QLOO_SERVER_URL, ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

## License

[GNU AGPL-3.0](LICENSE): you can use, study and change Larry, but if you run a modified version as a website or service, you must share its source under the same licence.
