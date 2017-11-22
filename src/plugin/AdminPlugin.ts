import {UrlService} from "../service/UrlService";
import {ApiInfoService} from "../service/ApiInfoService";
import {Config} from "../config/config";
import {UserListService} from "../service/UserListService";
import {DBConnect} from "../util/DBConnect";
import {YamlParse} from "../util/YamlParse";
import {RegisterPlugin} from "../plugin/RegisterPlugin";
import { SingleAPISwaggerFile} from "../util/SingleAPISwaggerFile";
import basicAuth = require("basic-auth");
import crypto = require("crypto");
import formidable = require("formidable");
import fs = require("fs");
import {SwaggerFile} from "../util/SwaggerFile";
import { GeneralResult } from "../general/GeneralResult";
import rq = require("request-promise");
import {CombinationUrlService} from "../service/CombinationUrlService";
import events = require("events");
class AdminPlugin{

    /**
     * 基于basic-auth的身份认证
     * @param req 
     * @param res 
     * @param next 
     */
    public basicAuth(req, res, next){
        function unauthorized(res) {
            console.log("需要登录")
            res.set('WWW-Authenticate', 'Basic real m=Input User&Password');
            return res.sendStatus(401);
        }
        let user = basicAuth(req);
        if (!user || !user.name || !user.pass) {
            return unauthorized(res);
        }
        // 查询条件
        let data: {[key: string]: string} = { user_name: user.name };
        let userListService: UserListService = new UserListService();
        (async () => {
            let result: GeneralResult = await userListService.query(data);
            if(result.getResult() == true){
                let results = result.getDatum();
                var password = null;
                if (results.length > 0) {
                    password = crypto.createHmac('sha256', user.pass).update(results[0].salt).digest('hex');
                    if (password === results[0].password) {
                        next();
                        return;
                    } else {
                        console.log("用户名或密码错误");
                        return unauthorized(res);
                    }
                } else {
                    console.log("未能登录");
                    return unauthorized(res);
                }
            }else{
                console.log("未能登录");
                return unauthorized(res);
            }
        })();
    }

    /**
     * 允许跨域访问
     * @param req 
     * @param res 
     * @param next 
     */
    public allowCORSAccess(req, res, next): void{
        res.header("Access-Control-Allow-Origin", "*");
        res.header('Access-Control-Allow-Methods', 'PUT, GET, POST, DELETE, OPTIONS');
        res.header("Access-Control-Allow-Headers", "X-Requested-With");
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
    }

    /**
     * API数据的注册
     * @param req 
     * @param res 
     */
    public APIRegister(req, res): void{
        // 根据JSdoc产生swagger的API配置文件
        let swaggerFile: SwaggerFile = new SwaggerFile();
        swaggerFile.generateFile();
        let path = new Config().getPath();
        let yamlParse: YamlParse = new YamlParse();
        let data: { [key: string]: string }[][] = yamlParse.parse(path.swaggerFile);
        let url: {[key: string]: string}[] = data[0];
        let apiInfo: {[key: string]: string}[] = data[1];
        // 将API注册信息加载到内存
        let registerPlugin: RegisterPlugin = new RegisterPlugin();
        registerPlugin.loadData(url);
        // 将数据存入数据库
        let urlService: UrlService = new UrlService();
        let apiInfoService: ApiInfoService = new ApiInfoService();
        urlService.loadData(url);
        apiInfoService.loadData(apiInfo);
        let config: Config = new Config();
        // 设置cookie，将fileName的值传给swagger UI的index.html文件使用
        res.cookie("fileName", "swagger.yaml");
        res.redirect(config.getPath().swaggerUIURL);
    }

    /**
     * 上传文件并完成注册
     * @param req 
     * @param res 
     */
    public upload(req, res): void{
        let config: Config = new Config();
        // 创建表单上传
        let form: formidable.IncomingForm = new formidable.IncomingForm();
        // 设置编辑
        form.encoding = 'utf-8';
        // 设置文件存储路径
        form.uploadDir = config.getPath().swaggerDir;
        // 保留后缀
        form.keppExtendsions = true;
        form.maxFieldsSize = 2 * 1024 * 1024;
        form.parse(req, function(err, fields, files){
            if(err){
                console.log(err.message);
            }else{
                // 获取文件名
                let fileName: string = fields.fileName;
                let file: string = config.getPath().swaggerDir + fileName;
                fs.renameSync(files.upload.path, file);
                let yamlParse: YamlParse = new YamlParse();
                let data: {[key: string]: any}[][] = yamlParse.parse(file);
                let url: {[key: string]: string}[] = data[0];
                let api_info: {[key: string]: string}[] = data[1];
                // 注册到内存和加载到数据库
                let registerPlugin: RegisterPlugin = new RegisterPlugin();
                let apiInfoService: ApiInfoService = new ApiInfoService();
                let urlService: UrlService = new UrlService();
                registerPlugin.addData(url);
                // let removeUrl: Promise<any> = urlService.remove({ "APPId": url[0].APPId });
                // removeUrl.then(function(){
                //     urlService.insert(url);
                // }).catch(function(err){
                //     console.log(err);
                // });
                // let removeApiInfo: Promise<any> = apiInfoService.remove({ "appId": api_info[0].appId});
                // removeApiInfo.then(function(){
                //     apiInfoService.insert(api_info);
                // }).catch(function(err){
                //     console.log(err);
                // });
                (async () => {
                    let removeUrl: GeneralResult = await urlService.remove({ "APPId": url[0].APPId });
                    let removeApiInfo: GeneralResult = await apiInfoService.remove({"appId": api_info[0].appId});
                    if(removeUrl.getResult() == true && removeApiInfo.getResult() == true){
                        // 插入新数据
                        urlService.insert(url);
                        apiInfoService.insert(api_info);
                        // 设置cookie，将fileName的值传给swagger UI的index.html文件使用
                        res.cookie("fileName", fileName);
                        res.redirect(config.getPath().swaggerUIURL);
                    }else{
                        res.json((removeUrl.getResult() == true ? removeUrl : removeApiInfo).getReturn());
                    }
                })();
            }
        });
    }

    /**
     * 上传文件界面
     * @param req 
     * @param res 
     */
    public uploadFileView(req, res): void{
        let config: Config = new Config();
        res.sendFile(config.getPath().uploadFileURL);
    }

    /**
     * 使用swagger UI查看已注册的API信息
     * @param req 
     * @param res 
     */
    public viewAPIs(req, res): void{
        let fileName: string = req.query.fileName;
        /**
         * 如果输入swagger文件名称，则转到对应的swagger UI
         * 否则转到管理API的swagger UI
         */
        let config: Config = new Config();
        if(fileName){
            // 设置cookie，将fileName的值传给swagger UI的index.html文件使用
            res.cookie("fileName", fileName);
            res.redirect(config.getPath().swaggerUIURL);
        }else{
            res.redirect(config.getPath().adminAPIsURL);
        }
    }

    /**
     * 使用swagger UI查看单个API信息
     * @param req 
     * @param res 
     */
    public viewSingleAPI(req, res): void{
        let singleAPISwaggerFile: SingleAPISwaggerFile = new SingleAPISwaggerFile();
        let config: Config = new Config();
        // 根据API的ID获取API对应的swagger信息
        let id: string = req.query.id;
        singleAPISwaggerFile.generateSingleSwaggerFile(id, config.getPath().swaggerFile, config.getPath().singleSwaggerFile);
        res.redirect(config.getPath().singleSwaggerFileURL);
    }
    
    //获取JSON解析器中间件  
    public jsonParser(){
        require("body-parser").json();
    }


    /**
     * 返回所有API数据
     * @param req 
     * @param res 
     */
    public async getAllAPI(req, res): Promise<void>{
        let apiInfoService: ApiInfoService = new ApiInfoService();
        let apiInfos: GeneralResult = await apiInfoService.query({});
        res.json(apiInfos.getReturn());
    }

    /**
     * 修改组合API名字
     * @param req
     * @param res
     */
    public async renameServiceName(req, res): Promise<void>{
        let apiInfoService: ApiInfoService = new ApiInfoService();
        let combinationUrlService: CombinationUrlService = new CombinationUrlService();
        let url: string = req.query.url;
        let serviceName: string = req.query.serviceName;
        let updateResult: GeneralResult = await apiInfoService.update({URL: url}, serviceName);
        let updataCombinnationResult: GeneralResult = await combinationUrlService.update({url: url}, serviceName);
        res.json(updateResult.getReturn());
    }

    /**
     * 封装rq，返回Boolean类型，判断访问是否成功
     * @param url 
     */
    private async _request(url: string): Promise<boolean>{
        return new Promise<boolean>(function(resolve){
            rq(url).then(function(){
                resolve(true);
            }).catch(function(){
                resolve(false);
            }); 
        });
    }
    public async debugAPI(req, res){
        let eventEmitter = new events.EventEmitter();
        let url: string = req.query.url;
        let config: Config = new Config();
        // 组合API和原子API对应的主机名
        let host: string = config.getAdminServer().host + config.getAdminServer().port;
        // 获取组合API的原子API ID 
        let combinationUrlService: CombinationUrlService = new CombinationUrlService();
        let queryResult: GeneralResult = await combinationUrlService.query({url:url});
        let id: string[] = queryResult.getDatum().atom_url.split(",");
        // 根据API的id查询API对应的url,并存储在urls中
        let urls: string [] = [];
        let apiInfoService: ApiInfoService = new ApiInfoService();
        for(let i = 0; i < id.length; i++){
            let result: GeneralResult = await apiInfoService.queryById(id[i]);
            urls[i] = (result.getDatum())[0].URL;
        }
        // 保存测试结果
        let data: Map<string, string> = new Map();
        let flag: boolean = true;
        let adminPlugin: AdminPlugin = new AdminPlugin();
        for(let i = 0; i < urls.length; i++){
            let result: boolean = await adminPlugin._request("http://www.linyimin.club:10010" + urls[i]);
            if(result !== true){
                flag = false;
                data.set(urls[i], "fail");
            }else{
                data.set(urls[i], "suceess");
            }
        }
        // 测试复合API的URL
        if(flag == true){
            let result: boolean = await adminPlugin._request("http://www.linyimin.club:8000" + url);
            if(result == true){
                data.set(url, "suceess");
                res.json(new GeneralResult(true, null, adminPlugin._mapToObject(data)).getReturn());
            }else{
                data.set(url, "fail");
                res.json(new GeneralResult(false, null, adminPlugin._mapToObject(data)).getReturn());
            }
        }else{
            
        }
        res.json(new GeneralResult(false, null, adminPlugin._mapToObject(data)).getReturn());
    }

    /**
     * 将Map转换成Object
     * @param data 
     */
    private _mapToObject(data: Map<string, string>): {[key: string]: string}{
        let result: {[key: string]: string} = {};
        for(let [key, value] of data){
            result[key] = value;
        }
        return result;
    }
}
export{AdminPlugin};
