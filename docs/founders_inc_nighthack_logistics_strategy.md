# Founders Inc. Nighthack: Event Logistics & Strategy Guide
Link: https://luma.com/nighthack?tk=VpQGgI
**Event Overview**
* **Host:** Founders Inc.
* **Attendees:** ~312 builders expected.
* **Core Format:** 5-hour high-intensity build sprint followed by live demos. 
* **Rule Check:** Existing codebase/scaffolding is *explicitly welcome*, but judges only score the work done during the 5-hour sprint. Therefore, prep your boilerplate and blank files *tonight* so you spend tomorrow only building the magic.

---

## 1. Timeline (Tomorrow)
* **4:00 PM:** Doors open.
* **4:15 PM:** Check-in & Team Formation. *(This is your window to recruit!)*
* **5:00 PM – 10:00 PM:** The Build Window (Exactly 5 hours).
* **10:00 PM – 11:00 PM:** Live Demos.
  * *Crucial Rule:* **NO SLIDES.** The judges only want to see working software. Your split-screen FreshGuard demo is perfectly optimized for this format.

---

## 2. Sponsors & Tech Stack Advantage
To win sponsor prizes and catch the judges' attention, you must lean heavily into the partner stack. FreshGuard is perfectly designed to highlight the two biggest sponsors:

* **Anthropic (Claude):** 
  * **The Perk:** $50 in API credits per builder to use during the event, and a $10K API credit grand prize.
  * **The Strategy:** FreshGuard is built on **MCP (Model Context Protocol)**, which was literally invented and open-sourced by Anthropic. Building infrastructure that makes Anthropic's MCP safer and more enterprise-ready is the ultimate way to pander to their judges. Use Claude 3.5 Sonnet for the agent.
* **Convex:**
  * **The Perk:** Sponsor of the event, providing backend infrastructure.
  * **The Strategy:** FreshGuard's entire "atomic transaction" guard relies on Convex's real-time database mutations. You will literally be demonstrating a core, powerful feature of Convex (optimistic concurrency) to solve an AI problem. Be sure to drop the word "Convex mutations" during your 3-minute pitch.
* **Bolt & Firecrawl:** 
  * *Optional but helpful:* Bolt (by StackBlitz) is a sponsor. If you use Bolt to scaffold your React frontend quickly at 5:00 PM, you can mention it to score points. Firecrawl is for web scraping—you probably won't need it for FreshGuard, but good to know.

---

## 3. Team Formation Strategy (How to not build alone)
You mentioned you are going alone. That is actually an advantage if you walk in with a clear, validated idea. At 4:15 PM, there will be a team formation mixer for solo devs. 

**Your Goal:** Recruit 1 or 2 teammates. Ideally, you want one Frontend/React developer. 
**Why?** They can spend 5 hours making the "Left Side" of the demo (the Convex inventory dashboard) look beautiful and polished, while you focus purely on the "Right Side" (the MCP server, Convex backend logic, and Claude integration).

**Your 30-Second Elevator Pitch to Find a Teammate:**
> *"Hey, I'm building FreshGuard. It's a middleware that prevents AI agents from executing destructive actions on stale data—basically cache coherence for MCP agents. I already have the architecture mapped out, the Convex schemas designed, and the demo scripted. I just need a solid React dev to help build out the real-time split-screen dashboard while I wire up the Claude MCP server. We're perfectly aligned for the Anthropic and Convex sponsor tracks. Want to team up?"*

---

## 4. Pre-Event Checklist (Do This Tonight)
1. **Scaffold the Repo:** Run `npm create vite@latest` and `npx convex dev` tonight. Get the folders ready. 
2. **Setup API Keys:** Get your Anthropic API key ready.
3. **Read the Docs:** Briefly review the Convex documentation on "Mutations" and "Optimistic Concurrency Control," as well as the official Anthropic MCP quickstart.
4. **Sleep:** You have a 5-hour sprint tomorrow; do not burn out tonight writing code that won't be judged. Just set the stage.




**Ideas to build:**
#1 -- **FreshGuard — “cache coherence for AI agents.”** This is probably what I would build tomorrow. Imagine an agent reads “Item X costs $80 and there are 3 left.” It thinks for 30 seconds, calls some other tools, perhaps waits for user approval — meanwhile another person changes the inventory to 0. The agent still has the old observation in its context and proceeds as if it were true. MCP has freshness semantics for some discovery/resource operations, but freshness of observations during long agent workflows remains a real problem. A paper published just this month specifically studies agents reusing stale observations after the underlying source changes. [arXiv](https://arxiv.org/abs/2610.05281?utm_source=chatgpt.com)

Your MVP would be a small middleware layer between an agent and its MCP tools. Every important observation gets a source, timestamp/version/hash, and dependency ID. Before a state-changing tool call, FreshGuard checks whether the observations that justified the action are still valid. If not, the agent receives `STALE_CONTEXT`, refreshes the data, and replans.

The demo could be beautiful. Left side: Convex dashboard showing inventory, reservation status, or a shared task. Right side: Claude agent. Ask it to “reserve the cheapest available GPU.” It reads the world. Then you manually change the availability in the dashboard while it is planning. A normal agent executes the now-wrong action. FreshGuard flashes **STALE DEPENDENCY DETECTED**, re-fetches the state, and chooses the new answer.

The startup pitch is: **“Databases have cache coherence. Distributed systems have consistency models. AI agents currently don't.”** That sentence alone is strong.
references:
https://arxiv.org/abs/2603.05637



#2 -- **CompileFlow — “use AI once; run code forever.”** This is the idea most directly connected to your notes. An agent completes some recurring workflow using 15 model calls, 40,000 tokens and five MCP tools. CompileFlow watches the successful execution, identifies which decisions were actually deterministic, and generates a normal TypeScript/Python workflow. The LLM is retained only at ambiguous decision points.

Run #1 might be: Claude + Firecrawl → find companies → scrape pages → identify pricing → normalize fields → save to database. Then CompileFlow generates code implementing the scraping, validation and normalization directly. Run #2 against another batch now requires perhaps one model call instead of fifteen.

Your demo screen should literally show:

`BEFORE: 18 LLM calls / 31,240 tokens / $0.42`  
`AFTER: 2 LLM calls / 3,100 tokens / $0.04`

Then show the generated workflow and its automatically generated tests.

There are early projects exploring deterministic LLM-workflow compilation, so the underlying concept isn't completely untouched. The interesting product wedge is **automatic production-trace → deterministic program → tests → measured savings**, rather than requiring engineers to manually author the workflow. [[Github](https://github.com/LiboWorks/llm-compiler)](https://github.com/LiboWorks/llm-compiler)

