# l402-mcp

An MCP (Model Context Protocol) server for testing and interacting with L402 (Lightning HTTP 402) services. It can probe protected endpoints, run the full L402 challenge-payment-retry flow with LNbits, inspect macaroons, and manage resources on an L402 gateway.

## Install

```bash
npm install -g l402-mcp
```

## Usage

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "l402": {
      "command": "npx",
      "args": [
        "-y",
        "l402-mcp",
        "--lnbits-url",
        "https://lnbits.example.com",
        "--lnbits-key",
        "your_lnbits_admin_key",
        "--gateway-key",
        "l402_sk_your_gateway_key"
      ]
    }
  }
}
```

### OpenClaw

Add to your OpenClaw MCP config:

```json
{
  "servers": {
    "l402": {
      "command": "l402-mcp",
      "args": [
        "--lnbits-url", "https://lnbits.example.com",
        "--lnbits-key", "your_lnbits_admin_key",
        "--gateway-key", "l402_sk_your_gateway_key"
      ]
    }
  }
}
```

### CLI

```bash
# Start the MCP server
l402-mcp --lnbits-url https://lnbits.example.com --lnbits-key your_admin_key

# With gateway configuration
l402-mcp \
  --lnbits-url https://lnbits.example.com \
  --lnbits-key your_admin_key \
  --gateway-url https://l402.nosaltres2.info \
  --gateway-key l402_sk_your_gateway_key

# Help
l402-mcp --help
```

## Tools

### `l402_request`
Run the full L402 flow against a URL:
1. Request the target URL
2. Detect a `402 Payment Required` response
3. Parse `WWW-Authenticate`
4. Pay the invoice via LNbits
5. Retry with `Authorization: L402 <macaroon>:<preimage>`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Target URL |
| `method` | string | ❌ | HTTP method, default `GET` |
| `body` | any | ❌ | Optional request body |
| `headers` | record | ❌ | Optional request headers |

### `l402_inspect`
Decode a macaroon and show its identifier and caveats.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `macaroon` | string | ✅ | Macaroon string |

### `l402_check`
Probe a URL to see if it is L402-protected and report the challenge details.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Target URL |

### `l402_create_resource`
Create or update a resource on the configured L402 gateway.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource_id` | string | ✅ | Resource identifier |
| `price_sats` | number | ✅ | Price in sats |
| `description` | string | ❌ | Resource description |
| `content_type` | string | ❌ | Content type |
| `ttl_seconds` | number | ❌ | Optional TTL |

### `l402_list_resources`
List resources from the configured L402 gateway.

### `l402_delete_resource`
Delete a resource from the configured L402 gateway.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource_id` | string | ✅ | Resource identifier |

### `l402_stats`
Fetch stats from the configured L402 gateway.

### `l402_balance`
Fetch the configured LNbits wallet balance.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LNBITS_URL` | LNbits base URL | *(none)* |
| `LNBITS_ADMIN_KEY` | LNbits admin API key | *(none)* |
| `L402_GATEWAY_URL` | L402 gateway URL | `https://l402.nosaltres2.info` |
| `L402_GATEWAY_KEY` | L402 gateway API key | *(none)* |

## Notes

- `l402_request` and `l402_balance` require LNbits credentials.
- Gateway management tools require `L402_GATEWAY_KEY`.
- The package supports both simple base64 JSON macaroons and signed `base64(payload).hex(hmac)` tokens.

## Links

- **Repository:** [github.com/jordiagi/l402-mcp](https://github.com/jordiagi/l402-mcp.git)
- **L402 Gateway:** [l402.nosaltres2.info](https://l402.nosaltres2.info)
- **Model Context Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)

## License

MIT
