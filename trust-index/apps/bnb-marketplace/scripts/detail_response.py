"""Validate registry detail before treating its missing endpoint as evidence."""
import json


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
    for service in (services or {}).values():
        if service is not None and not isinstance(service, dict):
            raise ValueError("detail service declaration must be an object or null")
        if service and service.get("endpoint") is not None and not isinstance(service["endpoint"], str):
            raise ValueError("detail service endpoint must be a string or null")
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
