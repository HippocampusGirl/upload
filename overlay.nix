{ self }: final: prev: { upload = self.packages.${prev.system}.upload; }
