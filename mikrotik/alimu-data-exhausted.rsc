# =====================================================================
# Alimu General Enterprises - Data-allowance reclaim
# ---------------------------------------------------------------------
# The router already cuts a user off when they consume their whole data
# allowance (limit-bytes-total), but the backend only tracks TIME - so the
# dashboard would otherwise keep showing ACTIVE until expires_at.
#
# This script finds those users (bytes-in + bytes-out >= limit-bytes-total),
# tells the backend to mark them expired, then removes them from the hotspot.
#
# Schedule every 1 minute:
#   /system scheduler add name="alimu-data-exhausted" interval=1m \
#       on-event="/system script run alimu-data-exhausted"
#
# >>> EDIT apiKey to match MIKROTIK_API_KEY in Supabase function secrets <<<
# =====================================================================

:local baseUrl "https://scarbubwnkdxarxxdzhj.supabase.co/functions/v1/hotspot"
:local apiKey "REPLACE_WITH_MIKROTIK_API_KEY"
:local markUrl "$baseUrl/api/mark-data-exhausted"

:local count 0
:foreach u in=[/ip hotspot user find] do={
    :local uname [/ip hotspot user get $u name]
    :if ([:len $uname] >= 4) do={
        :if ([:pick $uname 0 3] = "ALM") do={
            :local bIn [/ip hotspot user get $u bytes-in]
            :local bOut [/ip hotspot user get $u bytes-out]
            :local lim [/ip hotspot user get $u limit-bytes-total]
            :if (($lim > 0) and (($bIn + $bOut) >= $lim)) do={
                :log warning ("ALIMU-DATA: " . $uname . " used " . ($bIn + $bOut) . " of " . $lim . " - marking expired")
                :do {
                    /tool fetch url=("$markUrl/$uname\?api_key=$apiKey") mode=https check-certificate=no http-method=post keep-result=no
                } on-error={
                    :log warning ("ALIMU-DATA: mark failed for " . $uname)
                }
                :if ([:len [/ip hotspot active find user=$uname]] > 0) do={ /ip hotspot active remove [find user=$uname] }
                :if ([:len [/ip hotspot cookie find user=$uname]] > 0) do={ /ip hotspot cookie remove [find user=$uname] }
                /ip hotspot user remove $u
                :set count ($count + 1)
            }
        }
    }
}
:if ($count > 0) do={
    :log warning ("ALIMU-DATA: === " . $count . " data-exhausted user(s) reclaimed ===")
}
