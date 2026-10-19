const DATA_FOLDER='.data';
const isVaultData=relative=>relative===DATA_FOLDER||relative.startsWith(DATA_FOLDER+'/');
module.exports={DATA_FOLDER,isVaultData};
