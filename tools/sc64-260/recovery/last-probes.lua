SUMMARY=true
CLEARTEXT=true
function PROBES(run,pw,Btn)
  run({{72,330,pw(0,50,115)},{72,22,pw(Btn.A,50,115)},{98,34,pw(Btn.A,50,115)},{132,3,pw(Btn.Z,50,115)}}, 'text cleared', 18, 48, 400)
end
