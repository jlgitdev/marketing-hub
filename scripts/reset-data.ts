import { dataDirectory } from "../src/server/config";
import { resetAllData } from "../src/server/db/repository";

resetAllData();
console.log(`Marketing Hub records and assets reset inside ${dataDirectory()}`);
