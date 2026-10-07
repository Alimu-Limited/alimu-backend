# =====================================================================
# Alimu General Enterprises - Hotspot queue provisioner
# ---------------------------------------------------------------------
# Polls the backend, creates MikroTik hotspot users for paid orders, and
# applies the per-plan DATA allowance (GB) as limit-bytes-in / -out.
# Schedule it e.g. every 1 minute:
#   /system scheduler add name="alimu-provision" interval=1m \
#       on-event="/system script run alimu-provision"
# (put this file in /system script, or /import it once.)
#
# >>> EDIT the two lines below <<<
#   apiKey  = the MIKROTIK_API_KEY you set in Supabase function secrets
#   hotspotServer = your hotspot server name (default "hs-bridge-LAN")
# =====================================================================

:local apiUrl "https://scarbubwnkdxarxxdzhj.supabase.co/functions/v1/hotspot/api/mikrotik-queue-text"
:local markUrl "https://scarbubwnkdxarxxdzhj.supabase.co/functions/v1/hotspot/api/mark-processed"
:local apiKey "REPLACE_WITH_MIKROTIK_API_KEY"
:local hotspotServer "hs-bridge-LAN"

:do {
    :local oldF [/file find name="queue.txt"]
    :if ([:len $oldF] > 0) do={
        /file remove ($oldF->0)
        :delay 1s
    }
} on-error={}
:local fetchOk false
:do {
    /tool fetch url=("$apiUrl\?api_key=$apiKey") mode=https dst-path=queue.txt
    :delay 15s
    :set fetchOk true
} on-error={
    :log warning "ALIMU-PROV: Fetch failed"
}
:if ($fetchOk = false) do={ :return "" }

:local fileArr [/file find name="queue.txt"]
:if ([:len $fileArr] = 0) do={ :return "" }
:local fileId ($fileArr->0)
:local response [/file get $fileId contents]
/file remove $fileId
:if ([:len $response] < 5) do={ :return "" }

:local i 0
:local len [:len $response]
:local createdCount 0
:while ($i < $len) do={
    :local j [:find $response "\n" $i]
    :if ([:typeof $j] = "nil") do={ :set j $len }
    :local ln [:pick $response $i $j]
    :set i ($j + 1)
    :local cr [:find $ln "\r"]
    :if ([:typeof $cr] != "nil") do={ :set ln [:pick $ln 0 $cr] }
    :if ([:len $ln] > 5) do={
        :local p1 [:find $ln "|" 0]
        :if ([:typeof $p1] != "nil") do={
        :local p2 [:find $ln "|" ($p1 + 1)]
        :if ([:typeof $p2] != "nil") do={
        :local p3 [:find $ln "|" ($p2 + 1)]
        :if ([:typeof $p3] != "nil") do={
        :local p4 [:find $ln "|" ($p3 + 1)]
        :if ([:typeof $p4] != "nil") do={
        :local p5 [:find $ln "|" ($p4 + 1)]
        :if ([:typeof $p5] != "nil") do={
            :local username [:pick $ln 0 $p1]
            :local password [:pick $ln ($p1 + 1) $p2]
            :local plan     [:pick $ln ($p2 + 1) $p3]
            :local mac      [:pick $ln ($p3 + 1) $p4]
            :local expISO   [:pick $ln ($p4 + 1) $p5]
            :local rid      [:pick $ln ($p5 + 1) [:len $ln]]

            # ---- plan -> data allowance (GB) ----
            :local gb 4
            :if ($plan = "3d")  do={ :set gb 11 }
            :if ($plan = "5d")  do={ :set gb 19 }
            :if ($plan = "7d")  do={ :set gb 26 }
            :if ($plan = "14d") do={ :set gb 50 }
            :if ($plan = "30d") do={ :set gb 100 }
            :local bytes ($gb * 1073741824)

            :if ([:len $username] > 0) do={
            :if ([:len $rid] > 0) do={
                # ---- readable expiry comment (WAT = UTC+1) ----
                :local expDate [:pick $expISO 0 10]
                :local utcH [:tonum [:pick $expISO 11 13]]
                :local utcMin [:pick $expISO 14 16]
                :local expDay [:tonum [:pick $expDate 8 10]]
                :local expMon [:tonum [:pick $expDate 5 7]]
                :local expYear [:pick $expDate 0 4]
                :local watH ($utcH + 1)
                :if ($watH >= 24) do={
                    :set watH ($watH - 24)
                    :set expDay ($expDay + 1)
                    :local maxDay 31
                    :if ($expMon = 4 || $expMon = 6 || $expMon = 9 || $expMon = 11) do={ :set maxDay 30 }
                    :if ($expMon = 2) do={ :set maxDay 28 }
                    :if ($expDay > $maxDay) do={
                        :set expDay 1
                        :set expMon ($expMon + 1)
                        :if ($expMon > 12) do={ :set expMon 1; :set expYear ([:tonum $expYear] + 1) }
                    }
                }
                :local hStr [:tostr $watH]
                :if ($watH < 10) do={ :set hStr ("0" . $watH) }
                :local dStr [:tostr $expDay]
                :if ($expDay < 10) do={ :set dStr ("0" . $expDay) }
                :local mStr [:tostr $expMon]
                :if ($expMon < 10) do={ :set mStr ("0" . $expMon) }
                :local tag ("ALM|" . $plan . "|" . $expYear . "-" . $mStr . "-" . $dStr . "|" . $hStr . ":" . $utcMin)

                :local existing [/ip hotspot user find where name=$username]
                :if ([:len $existing] > 0) do={
                    :log warning ("ALIMU-PROV: " . $username . " exists, skipping")
                } else={
                    :do {
                        :if (([:len $mac] > 10) and ($mac != "none") and ($mac != "unknown")) do={
                            /ip hotspot user add name=$username password=$password server=$hotspotServer \
                                profile=$plan mac-address=$mac \
                                limit-bytes-in=$bytes limit-bytes-out=$bytes comment=$tag
                            :log warning ("ALIMU-PROV: CREATED " . $username . " | " . $gb . "GB | MAC:" . $mac)
                        } else={
                            /ip hotspot user add name=$username password=$password server=$hotspotServer \
                                profile=$plan \
                                limit-bytes-in=$bytes limit-bytes-out=$bytes comment=$tag
                            :log warning ("ALIMU-PROV: CREATED " . $username . " | " . $gb . "GB | no-MAC")
                        }
                    } on-error={
                        :log error ("ALIMU-PROV: FAILED to create " . $username)
                    }
                    :set createdCount ($createdCount + 1)
                    :do {
                        /tool fetch url=("$markUrl/$rid\?api_key=$apiKey") mode=https http-method=post keep-result=no
                        :log info ("ALIMU-PROV: Marked " . $rid . " processed")
                    } on-error={
                        :log warning ("ALIMU-PROV: Failed to mark " . $rid . " processed")
                    }
                }
            }
            }
        }
        }
        }
        }
        }
    }
}
:if ($createdCount > 0) do={
    :log warning ("ALIMU-PROV: === Created " . $createdCount . " user(s) ===")
}
