# =====================================================================
# Alimu General Enterprises - Hotspot stale-session kicker
# ---------------------------------------------------------------------
# Clears a STALE hotspot session that is blocking a returning device from
# auto-logging in ("no more sessions are allowed for user", because every
# plan profile has shared-users=1). It KEEPS the cookie, so the device can
# still auto-login afterwards.
#
# Schedule every 3 seconds (matches Sultanate's run-hotspot-kicker):
#   /system scheduler add name="alimu-kicker" interval=3s \
#       on-event="/system script run alimu-kicker"
# =====================================================================

:local ct [/system clock get time]
:local cstr [:pick $ct ([:len $ct] - 8) [:len $ct]]
:local nowS ([:tonum [:pick $cstr 0 2]] * 3600 + [:tonum [:pick $cstr 3 5]] * 60 + [:tonum [:pick $cstr 6 8]])
:local logs [/log find message~"no more sessions are allowed for user"]
:foreach logId in=$logs do={
  :local et [/log get $logId time]
  :local tstr [:pick $et ([:len $et] - 8) [:len $et]]
  :local eS ([:tonum [:pick $tstr 0 2]] * 3600 + [:tonum [:pick $tstr 3 5]] * 60 + [:tonum [:pick $tstr 6 8]])
  :local errAge ($nowS - $eS)
  :if ($errAge < 0) do={ :set errAge ($errAge + 86400) }
  :if ($errAge <= 300) do={
    :local msg [/log get $logId message]
    :local ipStart [:find $msg " ("]
    :if ([:typeof $ipStart] = "num") do={
      :local uname [:pick $msg 0 $ipStart]
      :if ([:len $uname] > 3) do={ :if ([:pick $uname 0 3] = "->:") do={ :set uname [:pick $uname 4 [:len $uname]] } }
      :if ([:len $uname] > 0) do={
        :local sessions [/ip hotspot active find user=$uname]
        :foreach sid in=$sessions do={
          :local u [/ip hotspot active get $sid uptime]
          :local uSecs [:tonum $u]
          :if ($uSecs > $errAge) do={
            /ip hotspot active remove $sid
            :log warning ("Hotspot Kicker: cleared stale session for [" . $uname . "] (uptime " . $u . " " . $uSecs . "s > error age " . $errAge . "s) - cookie kept for auto-login")
          }
        }
      }
    }
  }
}
