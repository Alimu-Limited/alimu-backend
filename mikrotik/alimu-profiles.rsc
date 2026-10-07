# =====================================================================
# Alimu General Enterprises - MikroTik Hotspot user-profiles
# ---------------------------------------------------------------------
# Paste once into the RouterOS terminal (or run via /import). Safe to
# re-run: it creates missing profiles and updates existing ones.
#
# Profile names MUST exactly match the plan codes the backend sends:
#   24hr, 3d, 5d, 7d, 14d, 30d
#
# Edit the rate-limit values ("5M/5M" = 5Mbps up / 5Mbps down) to suit
# your uplink. Data allowances (GB) are enforced per-user by the
# provisioning script (alimu-provision-queue.rsc), because RouterOS
# hotspot profiles cannot hold byte limits.
# =====================================================================

:foreach p in={"24hr";"3d";"5d";"7d";"14d";"30d"} do={
    :if ([:len [/ip hotspot user profile find name=$p]] = 0) do={
        /ip hotspot user profile add name=$p
    }
}

# Daily - 24 hours
/ip hotspot user profile set [find name="24hr"] session-timeout=1d  rate-limit="5M/5M"
# 3-Day
/ip hotspot user profile set [find name="3d"]   session-timeout=3d  rate-limit="5M/5M"
# 5-Day
/ip hotspot user profile set [find name="5d"]   session-timeout=5d  rate-limit="5M/5M"
# Weekly
/ip hotspot user profile set [find name="7d"]   session-timeout=7d  rate-limit="5M/5M"
# 2-Week
/ip hotspot user profile set [find name="14d"]  session-timeout=14d rate-limit="5M/5M"
# Monthly
/ip hotspot user profile set [find name="30d"]  session-timeout=30d rate-limit="5M/5M"

:log info "ALIMU-PROV: hotspot profiles ready (24hr,3d,5d,7d,14d,30d)"
