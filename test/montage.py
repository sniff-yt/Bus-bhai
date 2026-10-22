import sys
from PIL import Image
ims=[Image.open(f'screenshots/{n}.png') for n in sys.argv[2:]]
w=412;h=915
out=Image.new('RGB',(w*len(ims)+10*(len(ims)-1),h),'white')
for i,im in enumerate(ims): out.paste(im.resize((w,h)),(i*(w+10),0))
out.save(sys.argv[1])
