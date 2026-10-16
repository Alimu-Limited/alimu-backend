# =====================================================================
# Alimu General Enterprises - Expired-user reclaim
# ---------------------------------------------------------------------
# Polls the backend for accounts whose plan has expired, removes them
# from the hotspot, and marks them expired in the backend.
# Schedule every 1 minute:
#   /system scheduler add name="alimu-expire" interval=1m \
#       on-event="/system script run alimu-expire"
# >>> EDIT apiKey to match MIKROTIK_API_KEY in Supabase <<<
# =====================================================================

:local baseUrl "https://scarbubwnkdxarxxdzhj.supabase.co/functions/v1/hotspot"
:local apiKey "REPLACE_WITH_MIKROTIK_API_KEY"
:local expireUrl "$baseUrl/api/expired-users"
:local markUrl   "$baseUrl/api/mark-expired"

:do {
    :local oldF [/file find name="expired.txt"]
    :if ([:len $oldF] > 0) do={ /file remove ($oldF->0); :delay 1s }
} on-error={}
:local fetchOk false
:do {
    /tool fetch url=("$expireUrl\?api_key=$apiKey") mode=https dst-path=expired.txt
    :delay 5s
    :set fetchOk true
} on-error={
    :log warning "ALIMU-EXP: Fetch failed"
}
:if ($fetchOk = false) do={ :return "" }

:local fileArr [/file find name="expired.txt"]
:if ([:len $fileArr] = 0) do={ :return "" }
:local fileId ($fileArr->0)
:local response [/file get $fileId contents]
:file remove $fileId
:if ([:len $response] < 5) do={ :return "" }

:local i 0
:local len [:len $response]
:local removedCount 0
:while ($i < $len) do={
    :local j [:find $response "\n" $i]
    :if ([:typeof $j] = "nil") do={ :set j $len }
    :local ln [:pick $response $i $j]
    :set i ($j + 1)
    :local cr [:find $ln "\r"]
    :if ([:typeof $cr] != "nil") do={ :set ln [:pick $ln 0 $cr] }
    :if ([:len $ln] > 3) do={
        :local p1 [:find $ln "|" 0]
        :if ([:typeof $p1] != "nil") do={
            :local username [:pick $ln 0 $p1]
            :local lastBar 0
            :local k ($p1 + 1)
            :while ($k < [:len $ln]) do={
                :local b [:find $ln "|" $k]
                :if ([:typeof $b] = "nil") do={ :set k [:len $ln] } else={ :set lastBar $b; :set k ($b + 1) }
            }
            :local rid [:pick $ln ($lastBar + 1) [:len $ln]]
            :if (([:len $username] > 0) and ([:len $rid] > 0)) do={
                :if ([:len [/ip hotspot active find user=$username]] > 0) do={
                    /ip hotspot active remove [find user=$username]
                }
                :if ([:len [/ip hotspot cookie find user=$username]] > 0) do={
                    /ip hotspot cookie remove [find user=$username]
                }
                :if ([:len [/ip hotspot user find name=$username]] > 0) do={
                    /ip hotspot user remove [find name=$username]
                    :set removedCount ($removedCount + 1)
                    :log warning ("ALIMU-EXP: removed expired " . $username)
                }
                :do {
                    /tool fetch url=("$markUrl/$rid\?api_key=$apiKey") mode=https http-method=post keep-result=no
                } on-error={
                    :log warning ("ALIMU-EXP: failed to mark " . $rid)
                }
            }
        }
    }
}
:if ($removedCount > 0) do={
    :log warning ("ALIMU-EXP: === Removed " . $removedCount . " expired user(s) ===")
}
