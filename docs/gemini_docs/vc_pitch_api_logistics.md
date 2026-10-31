# VC Strategy & Developer Logistics
**Founders Inc. Nighthack Preparation**

## Part 1: The VC-Funded Pitch Strategy (Answering Eldar)

Eldar is right: Founders Inc. wants to see a massive market opportunity. We are sticking with the "FreshGuard" SDK idea, but we are going to frame it around high-stakes enterprise use cases.

When pitching to VC judges, frame the problem around **Financial Liability**. If an AI acts on stale data, a company loses money.

### Top 3 Billion-Dollar Use Cases (Pick one for your pitch):

1. **FinOps & Automated Trading (The "Money" Play - Highly Recommended)**
   * **The Setup:** A fintech company uses an AI agent to process refunds or execute trades.
   * **The Disaster:** The AI reads a user balance of $100. It spends 30 seconds reasoning about policy. Meanwhile, the user withdraws the $100. The AI finishes thinking and approves a $50 refund, pushing the account into the negative.
   * **The Pitch:** "FreshGuard is the transactional integrity layer for AI FinOps. Without it, agentic customer support is a massive financial exploit waiting to happen."
   
2. **Enterprise DevOps (The "Infrastructure" Play)**
   * **The Setup:** An SRE AI Agent is tasked with fixing a live server bug. 
   * **The Disaster:** It reads the config file and thinks for 45 seconds. A human engineer pushes a hotfix in the meantime. The AI pushes its change based on the old file, taking down the entire server.
   * **The Pitch:** "FreshGuard acts as the database lock for multi-agent enterprise systems and human-AI collaboration. It prevents agents from blindly destroying infrastructure."

3. **Supply Chain Logistics**
   * **The Setup:** Swarms of AI agents route trucks and book cargo based on live warehouse inventory.
   * **The Disaster:** Agent A sees 500 laptops and books a $5,000 freight truck. Agent B buys those laptops a millisecond later. The truck arrives to pick up nothing. 
   * **The Pitch:** "FreshGuard provides cache coherence for distributed physical AI systems."

**Demo Tweak:** Instead of "Reserving a GPU", make your Left-Side dashboard a "FinTech User Balance" or a "Server Configuration File". It takes the same amount of code but looks 100x more valuable to a VC.

---

## Part 2: How the $50 Anthropic Credit Works

You will likely be handed a promo code or a printed slip with an Anthropic API Key at check-in (or told to sign up at `console.anthropic.com` with a specific code). 

This $50 is for the **Developer API**, not the consumer `claude.ai` website. Here is exactly how you can use it to bypass your Cursor limits:

### 1. Using it in Cursor (Bring Your Own Key)
Since you maxed out your Claude limits in Cursor Pro, you can use the sponsor's API key to keep using Claude 3.5 Sonnet inside your IDE!
* **How to do it:** 
  1. Open Cursor Settings (Gear icon).
  2. Go to **Models**.
  3. Look for the **Anthropic API Key** input box.
  4. Paste your $50 hackathon key there and toggle the switch to use your custom key. 
  5. *Result:* Cursor's Composer will now drain your $50 Anthropic balance instead of your Cursor Pro limits.

### 2. Using it with Claude Code (CLI)
You mentioned you couldn't use Claude Code because you don't have Claude Pro. Good news: **Claude Code runs on the API, not Claude Pro!**
* **How to do it:**
  1. Open your Mac terminal.
  2. Run: `npm install -g @anthropic-ai/claude-code`
  3. Type `claude` and hit enter. 
  4. It will ask you to authenticate. You can use your Anthropic Console account (where the $50 promo is applied). 
  5. *Result:* You can now use Anthropic's official terminal agent to help you code the backend.

### 3. Using it in your App (The MCP Server)
Your actual hackathon project needs to talk to Claude to function.
* **How to do it:** Put the API key in your project's `.env` file (`ANTHROPIC_API_KEY=sk-ant-xxx...`). Your MCP server/agent script will use this key to make requests during your live demo.