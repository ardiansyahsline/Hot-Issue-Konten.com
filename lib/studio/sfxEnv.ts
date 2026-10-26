/**
 * Selubung puncak tiap SFX bawaan per frame (30 fps), dihitung dari file asli: 1 byte/frame, 0..255 = -60..0 dBFS.
 * Dipakai komposisi untuk "limiter" yang dihitung di muka: kalau beberapa suara keras menumpuk, semua musik & SFX
 * diturunkan sebentar supaya puncak gabungan tetap ≤ -1 dBTP (renderer browser tidak punya limiter).
 */
export const SFX_ENV_FPS = 30;
const RAW: Record<string, string> = {
"ai-magic": "AAAdZ2Vgja2tmK7CvrvEw8jTwNbc8dzQy8nRv8DDuLO708O6za7KtqzMtr6quqqonLOkm66hkZ+rj5GMi36Mf4SJkoyDeXh7dGttaWViW1dMST07QjcqHAQAAAAAAAAA",
"ambience-gelap": "AAAAGyQ8R0RTaG5qhH+IkIeTm5mTq6OUqKm6sq+4wLu1xMXG1dPPycHN18vQyMvK0cLAxdPQy9DNzMzPzM7U1dO7y8nU2NLU1cXP0tPJzs/TysvSxcnNzs3F1bO2w8vOycfT0NTSwM7NwtTUv8Td09PMy87U1snO2MzO19HQzM3GzsTR0dHWzc7Q0sLLzsPJyMrH0s3X0tXP0djVxLzL1tK6x83PycDQ0svEzcrS1czI0tPS1Nnb09bKyMvN1cTLzsvB087OzdLP0MPRyMzT0MPTzs/S0NvIzMrRzNbK1NLN1NPKx9TK1s/FyMnP09HS2s7Ey8bJ19DQxcjOzNPU1dPKyNHS2MrDzNbO18nMytPQ2NHN0crEwszB09TK2dHNwsjIzMXDzc/LyNnM2szRzcnL1s3Hus3Jz8vMyMrN09jNxtPMwcfI2NLLwdrN0tLJytjK0MfR2dLQytDLwdDQzc3TydXVydHZ0NLI2cbP2NbUwszY2dfOzdDQ0dfWzMzAzMXKxsvR1NPC0MfY0cjPzs/GzdDDztLH0NDTzcPR39fOz9DP0r7IxsnW3M7R0dHU0c/AxtTPvtDO1s/XyMPN19bUy87dx87V0NDMzczOxsbPz9zTys7X4MnKydDOzc/R1tDNy83S1NbYzNPT1tHJ0c3RzdLTydPQyM/Y0M7VyM3fydHP1MDKycfRzs3Ows3P2s/KwsvPvNDY08jExL7QzNTSyMbUy9PMxcnL2NzQyMvIysjNwcPIx8+6t8O+v7Kvtqa2rK+2o6ysqZmioI+enZeMfm9vbVpK",
"bass-drop-cepat": "MGR0fdDSxsfHy87R09XW19rd3t/g4ePj4+Pk5OTn5+fl5ebl6OTi5eni2d3T1dO/oaGZgnl8aXBiV1VbQzcmBA==",
"bass-drop-jumpstart": "AOTu7PLu5u3t6ujn6Ozo8PDw6O/v7enx8Ovk5OTk5OTl5eXl5ujp6uvr6uno6Orr7e7u7+/u7u3s6+vq6urp6urq6urr7Ozs7e3t7e3t7Ozr6+rp6Ofm5eTi3+Tg3s6yoYdeDwAAAAAAAAAAAAAAAA==",
"bass-drop-sedang": "3ufc5+Xi3d3k3+no6enq59/n4eHk5Nrk3N/k3+Dd2t7g2Nzc5OPh4+Pe5OTe5urp6uPn6OXo7Ovp5+Xi5Ovn6trm4uXs4uLc5d7d2+Pg497e4Nvj4uDe3d7p4drb1uDe3tbZ2NfZ1MrMys3Dwba8qrSjqJ6LcmEfAAAAAAAAAAAAAAAAAAAA",
"boom-trailer-1": "AAAAAAAAAA/6+vr69/fy+vr6+vr3+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr6+vr69/b4+vr49vb19/r1+Pb5+vr6+vr69/P07/Dw7Ojh6N/h5ubo6+ft7Off3N/Y2OLV4+Pk493ZztLL1dzY0dDX19HOysjRwsTGzbzIyMPJxcK/vcXDv7y+vLu1tre6vLa4qqi1q7KfraOmopKbkpeRe5qVipOLh4F8fG5yaWRdY1pWWVJHRDc0Hw0A",
"boom-trailer-2": "AAAAAAAAAL36+vXz7ufc1tC2ws3PxcnIwsTFxLe+y8DPzMrWxtTW0dTa0NXV0tPN0NnX0NHV0tXa0t3f1dbS4tfXz9ba2t7Wv9zMzN3S0c7U08zMyMzW3dfQ0sDH1NbWyb3Tw9PTvbnKv7+2x7+0r660t7W6s6OstLWnq6m4raqirq6lpaKUpbGgpZmaoqWXl5iWkaKQmZGNhH+PioyQi5GOg5CJfouGiHt+cod5cW9teX1lbHx9Ym14bGhqamttZmNcUmVaWlBeWE9TTktQSEs/OUBAOT89Pys9NzMmLCklFxkcGQwVBgMAAAAAAAAA",
"boom-trailer-3": "AAAAAAAAADz6+vb4+PHz+Pr0+vn3+O7x6/Lz6u766+718vD66urv8Ono5+3v9fXn7PTn8efr5fDt8/nr7Pjp7vbw6e349vDl7efs+fXs8+bm7erl5ufp8+zr8fTr6Onj7uv09fr6+fr39fr38fr29Pf6+vfy8Ovk4t7p5OPl3uPf3eTr5e7k5e7m6vXu5ezc3uTZ3tnT3NPW2NjRz9DSy8TIwc3Bx8jFw8bIw73Jv8TFw7/ExcXAwcbFwL6utbiqsK6ssqilr6Kcn5ianpmXl5OZkIWRioKChn55dHNtZ2hlY1leVFROU0ZELyQhGAAA",
"braam-epik-1": "AAAOP22Ww8fLxMbHysfCxsTGx8XFxsXAwsjOyMDGzM3BwbzDx8zMx8TEzs/MxcfFwcXGzs7CwMTAys3Kys3NzcvHxsfPzMbDyM7IycjBssTHxLzE0cbHxs3Ky8jHsbi7wMS+ucK4ybnBv7i8ucLEwr63t7m6usXDvr2/wb7Gvceyv7vFxL+5v8K+ssO5tMzLwL/BwLi5vMLLxbzGxMm9w87Bu72/wcK3vrvJx8fJw8XAxcDDwMTMysK8zMfEx8bI0M7U1c7KzcXKxcnMyL7ExsLBv8HEyMjFyMPAwLu8vLu6ubaxrKinpqKOh39zY04m",
"braam-epik-2": "S0xth6OttLa/xMbKy8jPy8vP0s3T1M3O0dfa2tnV1tbY1dHO3+DZ4eXe3ePi3tzW1dra1tXRzsnMztbW0dHXy9DZ4d3T0tbT4N3f3uTj6OjX293b2NrZ2dnb5Ojj3NfX29zg4d3c3t3d19rh3tvUydLW2d7g3dzb1dbc4+Xm5OPh4unp5d3a2NbZ3Nzc297g493f4+HX2trc3t7b2dbl5eTk5efn4eTi5uXj5unk5OXt6Onu8vT06unn3tTKzMzKy8nGtrCztrW4rKevsqmlpaWloZmdnqCcmI2OkI6Li4F0a3N3aXByXldSUEY5NhwA",
"braam-transisi-gelap": "AAAaNklcbXuEjo2foKqrqK+3t7m6vMDCzsnIytDNy9DR2dHb2tTS0dLR0c7T0Mzc39PW1s3a19Le4Nvk5eTh4N7k5eXi5+ne6uzn6fLo4dnYytbZ0M6to6egn6CXj350eG5ycGhVS0xQRk5JNSUmJCIhEw8AAAAAAAAAAAAAAAAAAAAAAAAA",
"glitch-error": "qMS41Nzcw+C63d7f2d3i49nRwt/R4NrY0t7Mz9LXycTe3tKz0Ofd4OOam8zb6PLbrcWt66HH8tjs6d7Yyrb02q6t2c7rztfwvOrdsLjcsfLT4La07eHU8tXq37raqfnwyca6vszGkqXAvsHNy8a8qbjChrK+wcfZ4b+Jh6msqbOAhcnanamqvZ/HipGOksC6wMKrnaCikZ/Lyc/Ewb/KyshmBQ==",
"glitch-tinggi": "t83U0tTV1dTV087hzM7My8zM0c7R0dbU1dbR1NbWyc7JzcbNzMnKysjKyMjKysrGxcbGxsLCw83KycXCv8LFyL61tLKuuLi0srKsqaaim5+al5OSh4l0bFw5",
"impact-chord": "T0ZHRkhfdYelqq+8xdHFxczN0NDV1tbc2Pb/18LHxLenpJuuqK2to8C5oZSQj4iTg3+KhoB6h3p8d3Jvb3Nsb2ZmaWhjYFldVFhQVk5PSkI8MTEoJxkTCAAAAAAAAAAAAA==",
"impact-cut-sweep": "FD91e4WKk5KVjZucnqCeoqaytLe2u8S7tRYA5evp+Pf55uXh29PKwLa1q5dnVl5bZXNmRklBOzw4LCUiIzQgKjYtOyYjGhwYDQEAAAAAAAAAAAAA",
"kertas-balik-halaman": "Y0FhUXWrknV1QT8sAAAAAAA=",
"koin-flip": "utns2tjjys/H8NvAroBXUjpFREUyOzcACAAAAAA=",
"koin-ting": "ACG94cy/xayro5+Qm4JxcWNcVEQ8OCwpHxMJAAAAAAAAAA==",
"notif-chat": "7tPAwOvEsaGDZUcpCgAAAAA=",
"riser-blastoff": "EzRATVhlaWxrdX58iJF/i4mag4yRj46QkY+SkJSNlpuUjZmfnJ+fmKWVjKWcnZ6boKSho52mqKScqKChpLGjlaamsLGnp6itr6ussLysrbW2r7CtuK6pqqi1sae7tLG2sLC2r7ivt768tqy5uL7Gvbu2wMK/wsa5v727wcK7wMfDysXKxsfIzsHBw8PJysjByMbHxb7Gw8jQyc/EyMfFy9LPwtrP0tfX1c3T0M7c0dLN0djP2s/Y0NHO2NPY2NLZ2MvOz8/O1tHQz9TY0NfMztrd19jW19bX19fe2drY1tLS09Xb1svc1tjX2tvV2NHT2N7U2dbU09XU1tLVzuOGSAMAAAAAAAA=",
"sukses-happy": "7OLc5+LVzsi6dwAAAAAAAAAAAAAAAAAAAAAA",
"swoosh-readout": "AAZ4kaaminiGnZOcobGkqsGywr241YnG4YpJOt7J6tz2187Qss9U0GnOqn2Dz14W0KwAAAAAz2kAAAAAAAAAAAAAAAAA",
"trailer-groove-perkusi": "uovn+OfTzKS4tKSAmqallIJ6lnB1a3RvgIWIdnl2inZ7c16izK/i3tviuaWtk62tfayRk5B1i3BwdHp0h2t5c42AeHhwaGyD1cHV6dTRur2vpp6GiZ+Iip2GcW9odIKEinZxZmZ/enRiaGWhta3Z6N7Vu8a4tIqNhp2nr4GMkmFvXl99dXpycGVnUF1fUW6MyL3b7+zXvbWcusWQmLGRi5aAgp+fdY2BZ3N2Z2N4dHR3cGyAy7XU5fLasLutkomcqr+VdXSRiHmDdpdza3F1bmpodGl3XmGCtLDm7uvRvLmcpJ6QsbaVnpSDhXp8iXiQjnp3eHpdY290Wl2MurXk6uHLwa+dtqKmmIGQj4yHgHt1iYFvWXJrdHFNY3SDdGZtxbje9ffLq6qqo6aYpKqKpqGRiYCGdXV0dIt0Xmh0a4VVY2FysrTk9PjVyKGdrLCoeJ6NpqB2a4OYinmDg3dtfW+XeW5bdXCPvbbg3OTMqrSlkZ+ZoZ+hp5B9cG1tdGtie4x6dl6Din9fUVl3w7fb5enOuLmwmJyRh6KNi4WMgYVra45yYYZ6cmVuaF5hc2OWtLrs7Ovd0KaxoqmNjp+RiYOLhnNccHt4d2dzcV9zfHOCaVOQuKrq597OqaadnK2KhauYi5B5cXtzcnRfmZSBaGlkZmZwZ2++6Mza4d/WwKWjp5uAn5qQdnZ2fXiDgIF8k5melGdgSFtMPmeQ1cno6ujWs7WplqqUgaOnp6WTcHyMe3dnaHV2XmGGhGNXa1RA",
"trailer-pulse-lambat": "9vb29fLx9PDs8vHv8O/z7e/u7e7x9PD08vfx6/Xz9Pf29/j39ff09/j39vj69vj49PX19vn49fj1+ff6+vb6+Pr4+Pj4+Pj29ffy9PDw8fTw8PXx8e308vH17/Hu8PPx9/Lu8PT09PP2+Pf39fj59/T49/b7+fj49vb6+Pn59vr6+fr2+fn59/X19fX39/f6+vfy9fLw8PD17+/v8e/x7/Dx7u7u8fDx9vbu8fX18/X19ff39PX69fb2+ff4/Pr39/j3/Pf6+PX4+Pr99/X49vn69Pn2+Pn4+PP28/Dy9Ozu8/Dw8vP07vLu8u/u8fDv+PTu8vP28/L6+PX29vr59PX2+Pj2+fr6+vn3+vf3+Pb49/n7+Pr69/X39vn79vX69fP48e3x8e7w8/bw8PDy8O/07vXw8vXs9vXx7/f49fT29ff2+PT29vb3+Pj79/j2+ff4+ff49/j6+fv4+ff6/Pv49/b49/r59/P18vHw8fHw7/H18vDt8fLu8u3x8PDx8/Tw7vPy8vb77/b29/f19vb2+Pr6/Pn3+vj3+fn7+fb29vX19fv5+Pb29vr69/j59vT07/Py8vHx8u/v8/Py7fDy7/Dz8O/v8vLw7vP19vP49fX1+PT09/f0+Pn5+fb3+vr2+Pr49fj1+fn6+vn39/n3+Pb39ff18O7w9O3y9fHt8vDw8vDw8u/z8fDu8PD19u7t8fb19fL19/j3+Pj09Pb39/n4+Pr49vf4+vX3+fj5+/j59/f3+vb29vj4+vz1wq+yuLS2uK+vra6sr62kqamgn6aho5+cnZmbnJuUkJuclI+LkomTjoKUjIqBioiAgH6Hin2CfHhzd399gHN0enJ3c25rc3FtYnJrZ2ptZ2JlZGZgZGJlZGBiXVxdaVdPWFtaVFFYWFNPTkxNSklNUkdIRkJCRkVIO0RBNUQ8Nzo1PTU0QDkxMzIyMy8rMy0lLC8qJyYkKSYgJB0gIiIaFx8ZFyIXDRMVExIdHBESBg4SDwcJCBAHCxQLBAUCAwUEAAIABgMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
"trailer-pulse-panjang": "9/X09/f49/n7+fbg4Nb2zMH2uPf399jL0L64qailqKOhnZqhqJebl5iRlpaVipKSh4mJi4iEg4SEf4GCgYJ7fX90d3JzcnJ0dHFya29ndG5uZmdkYmhmamleXF1ZXWFmWFpPXFZUWFNcT0xTTUtKSEdNRUtGQEZJPkA8QTw4Qzs8OkE6OTMuNTo1MDAuOS1i9/X09vf59/n59/bf3NT3zb31s/f299jM0LyvqaepqaSgnp6foKCSkJOMkJKPkIqEjZCRjYaMgXuAfH59eH55dXt0dXRwdINwb3Byb2ZtZmdlaGZfYGJoZVtaXFxiX1RdWVtQVFNOVlZQUU5aSFBJSUJGT0FKQjpEQUFDQD48PDk5OUA5NjM1NDMzLioyLzNh9/X09vT29/j4+PXi3tD4yMH3tvn3+dfN0L6yo7Gwp6KdpJ6bnZaWlpmWjI+Pio+KjoiHhIiDiX6CiYOAg3uAfXx3cnR4cW5sbW1tam9qaHVobmVjamloX1xhZWheVl1TWVlkVFpTVk5SVFJNVU5GQkZJRkpFRkk9Pj1IQTlBRTs3OTpENTY1NTEzMTktJjNd9/Xz9vf29/j4+Pfg2tX2yrz3uPj2+NzP1MC1q6ymo6ejn56hoKCUlpeQkpCejZCTjZCKj4mLgYSLhnuBgnx7fXl7dXl2dXFzc3dobXBtbGdkbWJkamdcY25pYF9aXlpfVl9YXVtUVVRSUUhWTk1VTkVLS0ZRUUNCQkRDP0ZAQTc6QTE4PDc2MzMzNjA1KzIvNiQsKCctKCMoJyYkJSImHCQlHhUbFRcUFR4RFREOGg0MDRITDgoMCgYFBhAFBQABAQkAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
"trailer-pulse-sedang": "9eX29vb29vX39fP29fb29vf2+Pb19vX4+Pb39vX59fn3+Pb19NDw9PT39/f49/f29vj29fb39fTy9vn49/b39vj19fDy9vn39tHz7vX48fX39fn39fb39vn2+PD09vf29/j39vj6+Pj39fD19dD37fj26/b29/f19/f39/j29PT09vb1+Pf49vj18fb59vP29tH37fX29vXz9vf29/j0+Pfy9vb29vT49/b49/f39Pb28vn29tD17fj48ff29fj49fj39vX09vHx+Pj5+Pj29ff29vn18/j29tfz8ff18vf49vX49/b59vb09vP09vP29vj29PTy9fj29PT29Nr09vf48/T2+Pb39ff49vf39vL29vX39vj1+Pb38vTz9vf49tX06/b48fX29/H09/f19ff49/f09/r2+fb39fb2+PX0+Pb0+Nj39vj38/b39vj19vj29vjx9/bz8/H29vb39ff39PT4+Pf49tXy9/b4+Pf2+ff4+Pf2+PT09/T1+Pj59/T48fT29vTw9fP28tD29/f27/T29vT49vT29PX29fTz+vf2+Pj29Pb19vb19Pb1+NP19/T29/f29/n39ff39vTy9vfz9fj3+Pj39Pn29fX09Pfy8dT08Pb28fX49/b0+fn59/f29fD28ff49vf39fb28/T08Pj299P48vf57vT5+PX19vX39/Xy9/fz9fb39vb3+fX49Pb28fXy99Pz9vf59fj49/b28+/3+fbw9/fz9vX3+Pf5+Pb49PD19fXytrKrqKuyrKWko6empKOdm52Yn5mdmpmRmZiTkZWMkIqOipOJhISEgoV+f4V/en18fHd5dXZ+b3R2b3BzcHBwaW9wZ2lkZmNxYGJhXl1VX1pfWVVUVlVXUE9RVVBLUlFOS0hPS0lKR0tDQENDO0BCQjk/Oz40Oj45Ny8zMjIvLjI4LDA0MSoqKCUnJSEnJyUhJCEdGxwaHyAYGhQcFxIWDxALBw8UCg0KBwsECAQEBwUFBgMCAAEAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
"transisi-shaker-snap": "QlRecXqwxZrBv8S8zdv08d68u8fNr62brbOZooxodY1VdDEzM59qYmFZXmE=",
"transisi-snap-spin": "AAAAEyMwO0VOVFxjaG5zd3yBhYmLkZSXnJ6ipaWmp6+usLSzu/Tw/f360NbcytTTycfLy7vRwLjCw8K+rsXC1Lu+xciru73QrsTNursAAAAAAAAAAAAAAAAAAAAAAAAA",
"ui-accept-boing": "2dXo4t/h5t/v3urO0NXO0rmXh3lsW1VDLiccCwQA",
"ui-accept-glassy": "1cStl35kUj4iAAAAAAA=",
"ui-arp-twinkle": "vtLe3uz06ezp49zU1tDOxMW7tqyloZWZkZGNhIJ4dW9uaWdjWVNRSD4oBwAAAAAAAAAAAAAAAA==",
"ui-plucks-happy": "49fD7s7D69Kv69vNqpKCd21lVRUAAAAAAAA=",
"ui-pop": "+uC4jgAAAAAAAAAAAAAAAAAAAAA=",
"ui-readout-panjang": "D9vv2+nTu9vw2unS2ufb5N7a5eDh2d7e4dvZ4cTd3Z/b79rp09vn2eTf2ubg4tje3uDb2uHD3dzk1+TRltvv2unSu9vw2+rT2+fa5N/a5eDi2d3e4tza4cPc3aDb79rp0tvo2uTf2ubg4Nnf3uHb2eLE3d3k2OXQ5tDl2AAAAAAAAAAA",
"ui-scifi-ping": "69Or8O3m39bQx7+3q6SggWQ1AAAAAAA=",
"ui-snap": "zaSDYlvoqI+GbFZHLAgAAAAAAAA=",
"whoosh-angin": "Kna+vKapppqcqq6knJKZnJSTtLWbobSxuqOdhndkUAA=",
"whoosh-cepat": "cPj+8JNoUWsPAAAAAAAA",
"whoosh-confetti": "TXOPv8PK2Nz4ura2rrW0v7+0tbKxr7+osa+zua+ysbO6rrWxtq6qoa+lq7eklJCVkI57cGNgRyQAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
"whoosh-debris": "LCtWcHaQk56ZvdLp+OHh4N7c2dfUzsjCva+gkHSsz46EhHyMzKWYn3+Hfn1sbGZuYVxjkXJcNVA8Ig4iFAAAAAAAAAAAAAAA",
"whoosh-metal": "MXl2kIehocjCwLTp98X0+tDL09C9udW0mJutund5i25iRTEYAA=="
};

const cache = new Map<string, Float32Array>();
/** puncak linear (0..1) per frame; SFX tambahan tanpa data -> null (dipakai perkiraan dari true peak) */
export function sfxEnv(id: string): Float32Array | null {
  const hit = cache.get(id);
  if (hit) return hit;
  // id dari data proyek: hanya kunci tabel ini (bukan bawaan objek seperti "constructor")
  const b64 = Object.prototype.hasOwnProperty.call(RAW, id) ? RAW[id] : undefined;
  if (!b64) return null;
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const q = bin.charCodeAt(i);
    out[i] = q === 0 ? 0 : Math.pow(10, ((q / 255) * 60 - 60) / 20);
  }
  cache.set(id, out);
  return out;
}
