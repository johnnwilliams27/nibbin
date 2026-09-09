"""Validate registry detail before treating its missing endpoint as evidence."""
import json

# Keys inside `services` that declare a callable interface, and so must be an
# object when present. Everything else in that map may be scalar metadata.
INTERFACE_KEYS = frozenset({"mcp", "a2a", "oasf", "web", "email", "api", "x402"})


def validate_detail(detail, candidate):
    if not isinstance(detail, dict) or detail.get("error"):
        raise ValueError("detail response is not a successful agent object")
    for field in ("agent_id", "chain_id", "token_id"):
        if field not in detail or str(detail[field]) != str(candidate[field]):
            raise ValueError(f"detail identity mismatch: {field}")
    if "services" not in detail or "supported_protocols" not in detail:
        raise ValueError("detail lacks interface declaration fields")
    protocols = detail["supported_protocols"]
    if not isinstance(protocols, list) or any(not isinstance(p, str) for p in protocols):
        raise ValueError("detail protocols must be a list of strings")
    services = detail["services"]
    if services is not None and not isinstance(services, dict):
        raise ValueError("detail services must be an object or null")
    for key, service in (services or {}).items():
        # `services` is not purely a map of service declarations: the registry
        # also files scalar identity values in it, e.g. services["ens"] =
        # "clawdmint.eth" and services["did"] = "did:ethr:0x...". Requiring
        # every value to be an object rejected 4 of 8,590 cached responses that
        # were perfectly valid, and a validator that discards good evidence is
        # worse than none -- it turns a live agent into a gap.
        #
        # So the object requirement applies only to keys that actually DECLARE
        # AN INTERFACE. An unknown key carrying a scalar is metadata and is
        # skipped; an unknown key carrying an object is still checked.
        if key not in INTERFACE_KEYS and not isinstance(service, dict):
            continue
        if service is not None and not isinstance(service, dict):
            raise ValueError(f"detail service declaration must be an object or null: {key}")
        if service and service.get("endpoint") is not None and not isinstance(service["endpoint"], str):
            raise ValueError(f"detail service endpoint must be a string or null: {key}")
    for field in ("mcp_server", "a2a_endpoint", "agent_url"):
        if detail.get(field) is not None and not isinstance(detail[field], str):
            raise ValueError(f"detail {field} must be a string or null")
    return detail


def read_detail(path, candidate):
    # Only a genuinely absent file returns None. Invalid or unreadable cache
    # must not be explained by a historical HTTP 429 failure record.
    try:
        with open(path, encoding="utf-8") as source:
            detail = json.load(source)
    except FileNotFoundError:
        return None
    return validate_detail(detail, candidate)
