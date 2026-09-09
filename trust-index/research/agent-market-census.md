# Agent market census

What exists, and what can be enumerated without a commercial relationship.

| Source | Kind | Enumerable | Listed | Callable or serious |
|---|---|---|---|---|
| Official MCP registry | tool provider | yes | 26906 | 15166 |
| Hugging Face Spaces | mixed | yes | 40000 | 10122 |
| Glama MCP directory | tool provider | no | - | - |
| Smithery | tool provider | no | - | - |
| mcp.so | tool provider | no | - | - |
| ERC-8004 registry (Base) | agent | yes | 84617 | 232 |
| ERC-8004, all 12 chains | agent | yes | 486745 | - |
| Olas Mech Marketplace (Base) | agent | yes | 51 | 23 |
| Virtuals ACP v2 (Base) | agent | yes | 12 | 12 |

## Notes per source

**Official MCP registry** (tool provider). Cursor-paginated, no API key, enumerated to the end with no duplicate rows. Counted by distinct server name, not by version row. Remotes are the subset a third party could exercise without installing anything.
  version rows returned: 90154; distinct servers: 26906; servers exposing a remote endpoint: 15166; servers install-only: 11740

**Hugging Face Spaces** (mixed). Public, paginated, no key. Spaces expose a documented API at /gradio_api/info, so they are directly exercisable. 10122 carry the mcp-server tag and publish themselves as callable services; the total is at least 40000. A mix of genuine services and demos, but the callable subset alone is larger than every on-chain population combined.
  tagged mcp-server (callable as a service): 10122; gradio, which all expose /gradio_api/info: 30472; total spaces (capped, floor only): 40000

**Glama MCP directory** (tool provider). HTTP 401: requires an API key, so independent enumeration needs a commercial relationship

**Smithery** (tool provider). HTTP 404: no public listing API at the documented path

**mcp.so** (tool provider). HTTP 500: no public listing API at the documented path

**ERC-8004 registry (Base)** (agent). Fully public on chain. 84,617 registered, but 77 percent share a wallet and a 600-agent sample found 232 publishing a callable endpoint.
  sampled for callability: 600

**ERC-8004, all 12 chains** (agent). Base is the only chain of twelve with any observed feedback activity.

**Olas Mech Marketplace (Base)** (agent). 51 mechs created, 23 with delivery outcomes. Real outcome data, tiny population.

**Virtuals ACP v2 (Base)** (agent). 1,924 jobs in twelve days from 12 distinct providers.

